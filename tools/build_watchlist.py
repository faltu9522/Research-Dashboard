"""Build android/app/src/main/assets/watchlist.js: the journals scanned for daily research insights.

ABDC 2025 A*/A/B journals in the user's areas (by title keywords), the relevant FT50 journals, and every journal the user
has submitted to or queued (ISSNs from the ABDC list, else looked up on Crossref).
Usage: python3 tools/build_watchlist.py ABDC-JQL-2025.xlsx
"""
import json
import re
import sys
import urllib.parse
import urllib.request
import warnings

import openpyxl

warnings.filterwarnings("ignore")
AREA = re.compile(r"communicat|discourse|language|linguist|rhetoric|\bmedia\b|marketing|consumer|advertis|ethic|"
                  r"organi[sz]ation|leadership|public relations|knowledge|sociolog|cultur|critical|qualitative|"
                  r"human relations|work,? employment|technology and society|information,? communication|"
                  r"politic|security|memory|philosoph|semiotic|journalism|public administration|public management", re.I)
CLOSE = re.compile(r"communicat|discourse|language|linguist|rhetoric|marketing|advertis|ethic|organi[sz]ation|leadership", re.I)
KNOWN = {  # ISSNs Crossref's name search misses (checked against api.crossref.org/journals/<issn>)
    "Theory, Culture and Society": ["0263-2764", "1460-3616"], "Philosophy & Social Criticism": ["0191-4537", "1461-734X"],
    "Corporate Communications: An International Journal": ["1356-3289", "1758-6046"],
    "Journal of Organizational Effectiveness: People and Performance (JOEPP)": ["2051-6614", "2051-6622"],
    "History & Memory": ["0935-560X", "1527-1994"]}
FT50 = ["Academy of Management Journal", "Academy of Management Review", "Administrative Science Quarterly",
        "Harvard Business Review", "Human Relations", "Human Resource Management", "Journal of Applied Psychology",
        "Journal of Business Ethics", "Journal of Consumer Psychology", "Journal of Consumer Research",
        "Journal of International Business Studies", "Journal of Management", "Journal of Management Studies",
        "Journal of Marketing", "Journal of Marketing Research", "Journal of the Academy of Marketing Science",
        "Marketing Science", "Organization Science", "Organization Studies", "Organizational Behavior and Human Decision Processes",
        "Strategic Management Journal", "MIT Sloan Management Review", "Entrepreneurship Theory and Practice",
        "Research Policy", "MIS Quarterly", "Information Systems Research", "Journal of Management Information Systems"]


def norm(s):
    s = (s or "").lower().replace("&", "and")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"^the ", "", s.strip())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def issns(*xs):
    out = []
    for x in xs:
        for m in re.findall(r"\d{4}-\d{3}[\dXx]", str(x or "")):
            if m.upper() not in out:
                out.append(m.upper())
    return out


def crossref_issn(name):
    url = "https://api.crossref.org/journals?rows=5&query=" + urllib.parse.quote(name) + "&mailto=snjy9522@gmail.com"
    try:
        items = json.load(urllib.request.urlopen(url, timeout=30))["message"]["items"]
    except Exception:
        return []
    for it in items:
        if norm(it.get("title")) == norm(name):
            return [i.upper() for i in it.get("ISSN", [])]
    return []


def main(abdc_path):
    wb = openpyxl.load_workbook(abdc_path, read_only=True)
    rows = [(r[1].strip(), str(r[7]).strip(), issns(r[3], r[4])) for r in wb["2025 JQL"].iter_rows(min_row=9, values_only=True) if r[1] and r[7]]
    by = {norm(t): (t, g, i) for t, g, i in rows}
    watch = {}
    for t, g, i in rows:
        if (g in ("A*", "A") and AREA.search(t) or g == "B" and CLOSE.search(t)) and i:
            watch[norm(t)] = {"name": t, "abdc": g, "ft50": False, "mine": False, "issn": i}
    for name in FT50:
        hit = by.get(norm(name))
        if hit:
            w = watch.setdefault(norm(name), {"name": hit[0], "abdc": hit[1], "ft50": True, "mine": False, "issn": hit[2]})
            w["ft50"] = True
    seed = json.loads(open("android/app/src/main/assets/seed.js", encoding="utf-8").read().split("=", 1)[1].rstrip().rstrip(";"))
    for j in sorted({s["journal"] for s in seed["subs"]}):
        if re.match(r"^(EPW|journals\.|link\.|meth\.|tandfonline)", j):
            continue
        key = norm(re.sub(r"\s*\((Sage|Wiley|SAGE|QROM|JBSP|JOEPP)\)", "", j))
        if key in watch:
            watch[key]["mine"] = True
            continue
        hit = by.get(key)
        i = KNOWN.get(j) or (hit[2] if hit else None) or crossref_issn(re.sub(r"\s*\(.*?\)", "", j).split(",")[0] if ":" not in j else j.split(":")[0])
        if i:
            watch[key] = {"name": hit[0] if hit else j, "abdc": hit[1] if hit else "", "ft50": False, "mine": True, "issn": i[:2]}
        else:
            print("no ISSN:", j)
    out = sorted(watch.values(), key=lambda w: (not w["mine"], not w["ft50"], w["name"].lower()))
    with open("android/app/src/main/assets/watchlist.js", "w", encoding="utf-8") as f:
        f.write("// Journals scanned for daily research insights (built by tools/build_watchlist.py).\nvar RD_WATCH = "
                + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\nif (typeof window !== 'undefined') window.RD_WATCH = RD_WATCH;\n"
                + "if (typeof module !== 'undefined') module.exports = { RD_WATCH: RD_WATCH };\n")
    print(len(out), "journals |", sum(w["mine"] for w in out), "yours |", sum(w["ft50"] for w in out), "FT50 |",
          {g: sum(1 for w in out if w["abdc"] == g) for g in ("A*", "A", "B", "")})


if __name__ == "__main__":
    main(sys.argv[1])
