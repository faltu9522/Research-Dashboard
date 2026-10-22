"""Turn Sheet 2 of SK_Research_Updates_2026.xlsx into clean RD SK data (papers + submissions).

Sheet 2 is the only valid record. Its layout: one block of rows per paper (title repeated in column B), journal in C,
date submitted in D, date of decision in E, authors / remarks in G (sometimes H). Fill colours carry the status:
  yellow + a date      -> the current submission (Under review)
  yellow, no date      -> planned next
  red                  -> an earlier attempt (Rejected); a row with no journal continues the row above it
  no colour, no date   -> journals considered; kept in the paper's notes as its shortlist
A paper with nothing current gets a Planned row for the journal its authors are written against (column G).

Usage: python3 tools/sheet2_import.py SK_Research_Updates_2026.xlsx data/current-data.json
"""
import datetime
import json
import re
import sys
import uuid

import openpyxl

SHEET = "Sheet2"
YELLOW, RED = {"FFFFFF00"}, {"FFFF0000", "FFEE0000"}
DATA_DATE = "2026-10-22"  # the day Sheet 2 was taken as the record

# short names for the app and sheet (the full title stays in Papers → Title); new papers get the title before ':'
KEYS = {
    "‘One dies’": ("‘One dies’: Blanchot & organizational speech", "Journal article"),
    "The Time That Obligates": ("The Time That Obligates (Derrida–Levinas)", "Journal article"),
    "Coffee with the Machine": ("Coffee with the Machine (EPW)", "EPW / short piece"),
    "Cockroaches, Not Citizens": ("Cockroaches, Not Citizens (CDA)", "Journal article"),
    "Distributed securitization": ("Distributed securitization (India SIR)", "Journal article"),
    "Bullshit Without a Bullshitter": ("Bullshit without a bullshitter (GenAI)", "Journal article"),
    "The algorithmic vernacular": ("The algorithmic vernacular (AI co-authorship)", "Journal article"),
    "Algorithmic silence": ("Algorithmic silence & org. power", "Journal article"),
    "Intentional Tacit Knowledge Hiding": ("Intentional tacit knowledge hiding (Malawi)", "Journal article"),
    "Who Spoke?": ("Who Spoke? (AI attribution)", "Journal article"),
    "Right to the Secret": ("The Right to the Secret (Foucault–Derrida)", "Journal article"),
    "Who gets Named?": ("Who gets named?", "Journal article"),
    "Organizational Silence": ("Organizational Silence (lit review)", "Journal article"),
    "Whose grief is political?": ("Whose grief is political?", "Journal article"),
    "Farmers’ Protest": ("Farmers’ protest & radical passivity", "Journal article"),
    "Is Leadership Inherently Violent?": ("Is Leadership Inherently Violent?", "Journal article"),
    "Methodological Trajectories": ("Cosmeceutical R&D trajectories (text mining)", "Journal article"),
    "We Are Family?": ("We Are Family? (corporate kinship talk)", "Journal article"),
}
SKIP_TITLES = ("Anamita ORCID", "Title")
# journal names as written in Sheet 2 -> the journal's real name
JOURNAL_FIX = {
    "TCS": "Theory, Culture and Society",
    "Organization: the critical journal of organization, theory and society": "Organization",
    "Media Culture and Soceity": "Media, Culture & Society",
    "Media Culture and Society": "Media, Culture & Society",
    "Journal of Knoledge Management": "Journal of Knowledge Management",
    "Vine": "VINE Journal of Information and Knowledge Management Systems",
    "qualitative research in organizations and management": "Qualitative Research in Organizations and Management",
    "language and communication": "Language and Communication",
    "Applied linguistics": "Applied Linguistics",
    "Ethics: an international journal of social, political, and legal philosophy": "Ethics",
    "INQUIRY-AN INTERDISCIPLINARY JOURNAL OF PHILOSOPHY": "Inquiry",
    "EPW: PostScript": "EPW (PostScript)",
    "EPW: Engage": "EPW (Engage)",
    "Journal of Information Communication and Ethics in Society": "Journal of Information, Communication and Ethics in Society",
    "Marketing and Morality": "Journal of Markets & Morality",
    "IEEE Transactions on Engineering Management": "IEEE Transactions on Engineering Management",
    "Discourse & Communication": "Discourse and Communication",
    "The Journal of Peasant Studies": "Journal of Peasant Studies",
    "QUALITATIVE INQUIRY": "Qualitative Inquiry",
    "Qualitative Research in Organizations and Management (QROM)": "Qualitative Research in Organizations and Management",
    "Mortality (Death and Dying)": "Mortality",
    "EducatioBnal Management, Administration & Leadership": "Educational Management, Administration & Leadership",
    "Critical Quarterly-Wiley": "Critical Quarterly",
    "JOURNAL OF SOCIAL PHILOSOPHY": "Journal of Social Philosophy",
    "APPLIED LINGUISTICS REVIEW": "Applied Linguistics Review",
    "MANOA-A PACIFIC JOURNAL OF INTERNATIONAL WRITING": "Manoa: A Pacific Journal of International Writing",
    "Theoria -philosophy": "Theoria",
}


def text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else ""


def fill(c):
    try:
        return c.fill.fgColor.rgb if c.fill and c.fill.fill_type == "solid" else ""
    except Exception:
        return ""


def day(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return ""


def clean_journal(raw):
    """'Journal of Management Inquiry-A' -> ('Journal of Management Inquiry', ''); keeps non-ABDC tags as the rating."""
    s = text(raw)
    s = re.sub(r"^(\d+\.\s*|Plan [A-Z]\s*[—–-]\s*)", "", s)
    s = re.sub(r"\s*\(ABDC\s*(A\*|A|B|C)\)\s*$", "", s)
    s = re.sub(r"\s*\((Wiley|Sage|SAGE|T&F|[A-Z]{2,6})\)\s*$", "", s)  # publisher / acronym in brackets
    rating = ""
    m = re.search(r"\s*[-–—]?\s*\b((SSCI|ESCI|IF)\b.*|Q[1-4]\b.*|FT50)\s*$", s)
    if m:
        rating = m.group(1).strip(" -–—")
        s = s[:m.start()]
    s = re.sub(r"\s*[-–—]\s*(A\*|A|B|C)\s*$", "", s)
    s = re.sub(r"\s+(A\*)\s*$", "", s)
    s = re.sub(r"\s*[-–—]\s*(A\*|A|B|C)\s*$", "", s)
    s = re.sub(r"\s*[-–—]\s*$", "", s).strip()
    s = re.sub(r"\s*[-–—]\s*(Speciial|Special) Article$", " (Special Article)", s)
    rating = re.sub(r"^IF\b", "IF", rating).replace("IF:", "IF ").replace("-", " ").strip()
    if rating == "FT50":
        rating = "FT50"
    return JOURNAL_FIX.get(s, s), rating


def is_authors(s):
    return bool(re.search(r"\b(Kaushal|Guha|Nyoni|Dhammi|Kovid)\b", s or ""))


def authors_of(s):
    s = re.sub(r"([a-z])\.\s+([A-Z])\.", r"\1, \2.", s)   # 'Guha. A.' -> 'Guha, A.'
    s = re.sub(r"\.\s+(?=[A-Z][a-z]+,)", "., ", s)  # 'Guha, A. Dhammi, S.' -> 'Guha, A., Dhammi, S.'
    s = re.sub(r",\s*,", ",", s)
    return re.sub(r"\s+", " ", s).strip(" ,")


def key_for(title):
    for prefix, kt in KEYS.items():
        if title.startswith(prefix):
            return kt
    return title.strip().rstrip(":"), "Journal article"


def parse(path):
    ws = openpyxl.load_workbook(path)[SHEET]
    blocks, order = {}, []
    for r in range(4, ws.max_row + 1):
        title = text(ws.cell(r, 2).value)
        if not title or title.startswith(SKIP_TITLES):
            continue
        group = title[:60]
        if group not in blocks:
            blocks[group] = {"title": re.sub(r"(2014–20)\d\d$", r"\g<1>25", title), "rows": []}
            order.append(group)
        c, d, e = ws.cell(r, 3), ws.cell(r, 4), ws.cell(r, 5)
        colours = {fill(c), fill(d), fill(e)}
        blocks[group]["rows"].append({
            "r": r, "journal": text(c.value), "submitted": day(d.value), "decided": day(e.value),
            "remark": text(ws.cell(r, 7).value), "extra": text(ws.cell(r, 8).value),
            "yellow": bool(colours & YELLOW), "red": bool(colours & RED)})

    papers, subs = [], []
    for group in order:
        b = blocks[group]
        key, ptype = key_for(b["title"])
        pid = str(uuid.uuid5(uuid.NAMESPACE_URL, "rdsk:paper:" + key))
        shortlist, mine = [], []
        named = [authors_of(t) for row in sorted(b["rows"], key=lambda x: not x["yellow"])
                 for t in (row["remark"], row["extra"], row["journal"]) if is_authors(t)]
        authors = named[0] if named else ""
        last = None
        for row in b["rows"]:
            j = row["journal"]
            if is_authors(j) or j.lower().startswith("http") and row["submitted"] == "":
                if j.lower().startswith("http"):
                    shortlist.append(j.split("#")[0])
                continue
            dated = row["submitted"] or row["decided"]
            if not j and dated and last:              # a later stage of the row above (same journal)
                last["stages"].append(row)
                continue
            if not j:
                continue
            name, rating = clean_journal(j)
            if dated and (row["red"] or row["yellow"] or row["decided"]):
                last = {"journal": name, "rating": rating, "first": row, "stages": [], "yellow": row["yellow"]}
                mine.append(last)
            elif row["yellow"]:
                mine.append({"journal": name, "rating": rating, "first": row, "stages": [], "yellow": True, "planned": True})
                last = None
            else:
                shortlist.append(name + (" (" + rating + ")" if rating else ""))
                if is_authors(row["remark"]):
                    mine.append({"journal": name, "rating": rating, "first": row, "stages": [], "target": True, "planned": True})
                last = None
        rows = []
        for m in mine:
            f, st = m["first"], m["stages"]
            notes = [x["remark"] for x in [f] + st if x["remark"] and not is_authors(x["remark"])]
            if m.get("planned"):
                rows.append(dict(journal=m["journal"], rating=m["rating"], status="Planned", submitted="", decided="",
                                 notes="; ".join(notes)))
            elif m["yellow"] and st and any(re.search(r"revision", x["remark"], re.I) for x in st):
                # revision cycle: the first round closes as 'Revision resubmitted', the revised version is under review
                rev = next(x for x in st if re.search(r"revision", x["remark"], re.I))
                again = [x for x in st if x["submitted"] and x["submitted"] > rev["submitted"]]
                rows.append(dict(journal=m["journal"], rating=m["rating"], status="Revision resubmitted", submitted=f["submitted"],
                                 decided=rev["decided"], notes="; ".join(notes)))
                if again:
                    rows.append(dict(journal=m["journal"], rating=m["rating"], status="Under review", submitted=again[-1]["submitted"],
                                     decided="", notes="Revised version resubmitted"))
            elif m["yellow"] and not f["decided"]:
                rows.append(dict(journal=m["journal"], rating=m["rating"], status="Under review", submitted=f["submitted"], decided="",
                                 notes="; ".join(notes)))
            else:
                notes = [n for n in notes if not re.match(r"(awaiting|with editor|under review)", n, re.I)]
                decided = (st[-1]["decided"] if st and st[-1]["decided"] else f["decided"])
                if st:
                    notes.append("stages in Sheet 2: " + ", ".join(x["submitted"] + "→" + x["decided"] for x in [f] + st))
                rows.append(dict(journal=m["journal"], rating=m["rating"], status="Rejected", submitted=f["submitted"], decided=decided,
                                 notes="; ".join(notes)))
        if not any(x["status"] in ("Under review", "Planned") for x in rows):
            pass  # nothing current: the paper waits for its next journal (shortlist in its notes)
        # planned rows go last; history in date order
        hist = sorted([x for x in rows if x["status"] != "Planned"], key=lambda x: (x["submitted"] or x["decided"] or "9"))
        plan = [x for x in rows if x["status"] == "Planned"]
        tried = {x["journal"].lower() for x in rows}
        shortlist = [s for i, s in enumerate(shortlist) if s not in shortlist[:i] and s.split(" (")[0].lower() not in tried]
        papers.append({"id": pid, "key": key, "title": b["title"].strip(), "authors": authors, "type": ptype, "override": "",
                       "notes": ("Shortlist (Sheet 2): " + "; ".join(shortlist)) if shortlist else ""})
        for x in hist + plan:
            x["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "rdsk:sub:%s|%s|%s|%s" % (key, x["journal"], x["submitted"], x["status"])))
            x["paper"] = pid
            x["titleUsed"] = ""
            subs.append(x)
    return papers, subs


def main(src, out):
    papers, subs = parse(src)
    data = {"source": "SK_Research_Updates_2026.xlsx, Sheet 2", "asOf": DATA_DATE,
            "papers": papers, "subs": [{k: s[k] for k in ("id", "paper", "journal", "rating", "status", "submitted", "decided", "notes", "titleUsed")} for s in subs]}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    count = lambda st: sum(1 for s in subs if s["status"] == st)
    print("papers=%d submissions=%d under_review=%d planned=%d rejected=%d" % (
        len(papers), len(subs), count("Under review"), count("Planned"), count("Rejected")))


if __name__ == "__main__":
    main(*sys.argv[1:3])
