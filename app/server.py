#!/usr/bin/env python3
"""Research submissions tracker: a tiny local web app.

Needs only Python 3.8+ (standard library). Data lives in data/research.db next to this file.
Run:  python server.py      then open http://localhost:8765
"""
import json
import os
import shutil
import sqlite3
import sys
import threading
import time
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
DB_PATH = os.path.join(DATA_DIR, "research.db")
PORT = int(os.environ.get("PORT", "8765"))
LOCK = threading.Lock()

PAPER_FIELDS = ["name", "title", "authors", "type", "override", "notes"]
SUB_FIELDS = ["paper_id", "journal", "rating", "status", "submitted", "decided", "notes", "title_used", "position"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', authors TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Journal article', override TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  journal TEXT NOT NULL DEFAULT '', rating TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Planned',
  submitted TEXT NOT NULL DEFAULT '', decided TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', title_used TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def touch(con):
    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_update', ?)", (str(int(time.time())),))


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    fresh = not os.path.exists(DB_PATH)
    if not fresh:  # one backup per day, keep the last 30
        bdir = os.path.join(DATA_DIR, "backups")
        os.makedirs(bdir, exist_ok=True)
        dst = os.path.join(bdir, f"research-{date.today().isoformat()}.db")
        if not os.path.exists(dst):
            shutil.copy2(DB_PATH, dst)
        for old in sorted(os.listdir(bdir))[:-30]:
            os.remove(os.path.join(bdir, old))
    con = connect()
    con.executescript(SCHEMA)
    if con.execute("SELECT COUNT(*) FROM papers").fetchone()[0] == 0:
        seed = os.path.join(HERE, "seed.json")
        if os.path.exists(seed):
            with open(seed, encoding="utf-8") as f:
                load_papers(con, json.load(f))
    con.commit()
    con.close()


def load_papers(con, papers):
    for p in papers:
        cur = con.execute(
            "INSERT INTO papers(name, title, authors, type, override, notes) VALUES (?,?,?,?,?,?)",
            [str(p.get(k, "") or "") for k in PAPER_FIELDS],
        )
        pid = cur.lastrowid
        for pos, s in enumerate(p.get("subs", []), 1):
            con.execute(
                "INSERT INTO submissions(paper_id, journal, rating, status, submitted, decided, notes, title_used, position) VALUES (?,?,?,?,?,?,?,?,?)",
                [pid, s.get("journal", ""), s.get("rating", ""), s.get("status", "Planned"), s.get("submitted", ""),
                 s.get("decided", ""), s.get("notes", ""), s.get("title_used", ""), pos],
            )
    touch(con)


def snapshot(con):
    papers = [dict(r) for r in con.execute("SELECT * FROM papers ORDER BY id")]
    subs = [dict(r) for r in con.execute("SELECT * FROM submissions ORDER BY paper_id, position, id")]
    row = con.execute("SELECT value FROM meta WHERE key='last_update'").fetchone()
    return {"papers": papers, "subs": subs, "last_update": int(row[0]) if row else 0}


def clean(body, fields):
    return {k: ("" if body.get(k) is None else body.get(k)) for k in fields if k in body}


class Handler(BaseHTTPRequestHandler):
    server_version = "ResearchTracker/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, payload=None, ctype="application/json", extra=None):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8") if payload is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text") or ctype == "application/json" else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("localhost", "127.0.0.1", "[::1]")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "static", "index.html"), "rb") as f:
                return self._send(200, f.read(), "text/html")
        if path == "/favicon.ico":
            return self._send(204)
        if path == "/api/data":
            with LOCK, connect() as con:
                return self._send(200, snapshot(con))
        if path == "/api/export":
            with LOCK, connect() as con:
                snap = snapshot(con)
            return self._send(200, snap, extra={"Content-Disposition": f'attachment; filename="research-tracker-{date.today().isoformat()}.json"'})
        self._send(404, {"error": "not found"})

    def _mutate(self, method):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).hostname not in ("localhost", "127.0.0.1", "::1"):
            return self._send(403, {"error": "bad origin"})
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        try:
            body = self._body() if method in ("POST", "PUT") else {}
            with LOCK, connect() as con:
                result = self._route(con, method, parts, body)
                touch(con)
            self._send(200, result)
        except (KeyError, ValueError, sqlite3.Error) as e:
            self._send(400, {"error": str(e)})

    def _route(self, con, method, parts, body):
        if len(parts) < 2 or parts[0] != "api":
            raise KeyError("not found")
        kind = parts[1]
        rid = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else None
        if kind == "papers":
            if method == "POST":
                f = clean(body, PAPER_FIELDS)
                if not (f.get("title") or f.get("name")):
                    raise ValueError("title required")
                cur = con.execute(f"INSERT INTO papers({','.join(f)}) VALUES ({','.join('?' * len(f))})", list(f.values()))
                return {"id": cur.lastrowid}
            if method == "PUT" and rid:
                f = clean(body, PAPER_FIELDS)
                if f:
                    con.execute(f"UPDATE papers SET {','.join(k + '=?' for k in f)} WHERE id=?", [*f.values(), rid])
                return {"ok": True}
            if method == "DELETE" and rid:
                con.execute("DELETE FROM papers WHERE id=?", (rid,))
                return {"ok": True}
        if kind == "submissions":
            if parts[2:3] == ["order"] and method == "POST":
                for pos, sid in enumerate(body.get("ids", []), 1):
                    con.execute("UPDATE submissions SET position=? WHERE id=?", (pos, int(sid)))
                return {"ok": True}
            if method == "POST":
                f = clean(body, SUB_FIELDS)
                if not f.get("paper_id") or not f.get("journal"):
                    raise ValueError("paper and journal required")
                if "position" not in f:
                    f["position"] = con.execute("SELECT COALESCE(MAX(position),0)+1 FROM submissions WHERE paper_id=?", (f["paper_id"],)).fetchone()[0]
                cur = con.execute(f"INSERT INTO submissions({','.join(f)}) VALUES ({','.join('?' * len(f))})", list(f.values()))
                return {"id": cur.lastrowid}
            if method == "PUT" and rid:
                f = clean(body, SUB_FIELDS)
                if f:
                    con.execute(f"UPDATE submissions SET {','.join(k + '=?' for k in f)} WHERE id=?", [*f.values(), rid])
                return {"ok": True}
            if method == "DELETE" and rid:
                con.execute("DELETE FROM submissions WHERE id=?", (rid,))
                return {"ok": True}
        if kind == "import" and method == "POST":
            data = body.get("papers")
            if isinstance(data, list) and isinstance(body.get("subs"), list):  # an /api/export file
                by_paper = {}
                for sb in body["subs"]:
                    by_paper.setdefault(sb.get("paper_id"), []).append(sb)
                data = [{**p, "subs": by_paper.get(p.get("id"), [])} for p in data]
            if not isinstance(data, list):
                raise ValueError("expected a list of papers with nested subs")
            con.execute("DELETE FROM submissions")
            con.execute("DELETE FROM papers")
            load_papers(con, data)
            return {"ok": True}
        raise KeyError("not found")

    def do_POST(self):
        self._mutate("POST")

    def do_PUT(self):
        self._mutate("PUT")

    def do_DELETE(self):
        self._mutate("DELETE")


def main():
    init_db()
    url = f"http://localhost:{PORT}"
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Research tracker running at {url}   (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
