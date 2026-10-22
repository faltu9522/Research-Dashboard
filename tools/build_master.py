"""Build the RD SK master workbook (for Google Sheets) and the app's seed data.

With data/current-data.json (made from Sheet 2 by tools/sheet2_import.py) as the second argument, that file is the
whole record: papers and submissions come only from it.

Combines the app's full submission history (seed.js), the user's SK_Research_Updates_2026.xlsx (latest papers and
journals) and the official ABDC Journal Quality List (2025 ratings, 2022 for journals that dropped off).

Usage: python3 tools/build_master.py seed.js SK_Research_Updates_2026.xlsx ABDC-JQL-2025.xlsx portals.js \
           excel/RD-SK-Master.xlsx android/app/src/main/assets/seed.js
"""
import datetime
import json
import os
import re
import subprocess
import sys
import uuid
import warnings

import openpyxl
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

warnings.filterwarnings("ignore")

STATUSES = ["Planned", "Under review", "Revision requested", "Revision resubmitted", "Rejected",
            "Returned by office", "Accepted", "Withdrawn"]
TODAY = "2026-10-22"

# ---------- changes from SK_Research_Updates_2026.xlsx (read by hand: its layout is free-form) ----------
RENAME_JOURNAL = {"IJEM": "International Journal of Educational Management", "Security Dialogue-A": "Security Dialogue",
                  "Communication Research-A": "Communication Research",
                  "International Journal of Information Management-A": "International Journal of Information Management"}
PAPER_UPDATES = {  # key in app data -> fields from the new sheet
    "‘One dies’: Blanchot & organizational speech": {"authors": "Kaushal, S., Guha, A."},
    "Distributed securitization (India SIR)": {"authors": "Kaushal, S., Guha, A., Dhammi, S."},
    "Bullshit without a bullshitter (GenAI)": {"authors": "Kaushal, S., Guha, A."},
    "The Right to the Secret:": {"key": "The Right to the Secret (Foucault–Derrida)", "title": "Right to the Secret (Foucault Derrida)",
                                 "authors": "Kaushal, S., Guha, A."},
    "Who gets named? Name Retention and Attribution Style in Indian Fact-Checking": {"key": "Who gets named?",
        "title": "Who gets named? Name Retention and Attribution Style in Indian Fact-Checking"},
    "Organizational Silence (lit review)": {"title": "The Deficit Model of Organization Silence – A bibliometric review and a Case for Blanchot and Levinas",
                                            "authors": "Kaushal, S."},
    "Whose grief is political? Grieving rules and the securitization of mourning in Indian news media": {
        "key": "Whose grief is political?", "title": "Whose grief is political? Grieving rules and the securitization of mourning in Indian news media",
        "authors": "Kaushal, S., Guha, A."},
    "Assessing in Whose Language?": {"authors": "Guha, A., Kaushal, S."},
    "Hedging machines: a systematic review": {"title": "Hedging machines: a systematic review"},
    "Who Spoke? Attribution Distortion and the Split Production Format of AI-Assisted Communication": {"key": "Who Spoke? (AI attribution)"},
    "The Deficit Model of Organization Silence- A bibliometric review and a Case for Blanchot and Levinas": {"merge_into": "Organizational Silence (lit review)"},
}
NEW_PAPERS = [  # papers only in the new sheet
    {"key": "Is the Apology the Same Size?", "title": "Is the Apology the Same Size?", "authors": "Guha, A., Kaushal, S."},
    {"key": "Can Virtue Be Advertised?", "title": "Can Virtue Be Advertised?", "authors": "Guha, A., Kaushal, S."},
    {"key": "We Are Family? (corporate kinship talk)", "title": "We Are Family? Corporate Kinship Talk", "authors": "Guha, A., Kaushal, S."},
]
NEW_PLANNED = [  # (paper key after renames, journal, first in queue?)
    ("Who gets named?", "Political Communication", True),
    ("Can Virtue Be Advertised?", "Journal of Markets & Morality", True),
    ("Cosmoceuticals", "Technology Analysis and Strategic Management", True),
]
SUB_FIXES = [  # (paper key, journal, field, value)
    ("Distributed securitization (India SIR)", "Security Dialogue", "submitted", "2026-10-11"),
]
LIVE = {("Farmers’ protest & radical passivity", "Applied Linguistics", "Under review"): "Awaiting reviewer scores"}
ORDER = [  # paper order of the new sheet; the rest follow
    "‘One dies’: Blanchot & organizational speech", "Death & language: Heidegger–Blanchot", "Derrida hauntology & memory ethics",
    "Cockroaches, Not Citizens (CDA)", "Distributed securitization (India SIR)", "Bullshit without a bullshitter (GenAI)",
    "Algorithmic silence & org. power", "Intentional tacit knowledge hiding (Malawi)", "Who Spoke? (AI attribution)",
    "The Right to the Secret (Foucault–Derrida)", "Who gets named?", "Organizational Silence (lit review)", "Whose grief is political?",
    "Assessing in Whose Language?", "Hedging machines: a systematic review", "Farmers’ protest & radical passivity",
    "Is the Apology the Same Size?", "Can Virtue Be Advertised?", "We Are Family? (corporate kinship talk)",
    "Is Leadership Inherently Violent?", "Cosmoceuticals"]
ABDC_ALIAS = {"Journal of Organizational Effectiveness: People and Performance (JOEPP)": "Journal of Organizational Effectiveness",
              "Corporate Communications: An International Journal": "Corporate Communications",
              "Organization: the critical journal of organization, theory and society": "Organization",
              "Journal of Communication (Special Issue)": "Journal of Communication"}
NO_FUZZY = True  # only exact title matches against the ABDC list


def norm(s):
    s = (s or "").lower().replace("&", "and")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"^the ", "", s.strip())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def app_norm(s):  # same as normJ() in the app
    s = (s or "").lower().replace("&", "and")
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"-a$", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def load_abdc(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    full = [(r[1].strip(), str(r[7]).strip(), int(r[6]) if str(r[6]).strip().isdigit() else 0, (r[2] or "").strip())
            for r in wb["2025 JQL"].iter_rows(min_row=9, values_only=True) if r[1] and r[7]]
    r25 = {norm(t): (g, t) for t, g, _, _ in full}
    r22 = {norm(r[0]): str(r[6]).strip() for r in wb["2022 JQL"].iter_rows(min_row=10, values_only=True) if r[0] and r[6]}
    return r25, r22, full


def main(seed_path, _new_sheet, abdc_path, portals_path, out_xlsx, out_seed):
    seed = json.loads(open(seed_path, encoding="utf-8").read().split("=", 1)[1].rstrip().rstrip(";"))
    if _new_sheet.endswith(".json"):
        cur = json.load(open(_new_sheet, encoding="utf-8"))
        papers = {p["id"]: dict(p) for p in cur["papers"]}
        subs = [dict(s) for s in cur["subs"]]
        seed["settings"]["lastUpdated"] = cur["asOf"]
        build(seed, papers, subs, [p["id"] for p in cur["papers"]], abdc_path, portals_path, out_xlsx, out_seed)
        return
    papers = {p["id"]: dict(p) for p in seed["papers"]}
    subs = [dict(s) for s in seed["subs"]]
    key_to_id = {p["key"]: p["id"] for p in papers.values()}

    # paper updates, renames and merges
    for old_key, upd in PAPER_UPDATES.items():
        pid = key_to_id.get(old_key)
        if not pid:
            raise SystemExit("paper not found: " + old_key)
        if "merge_into" in upd:
            target = key_to_id[upd["merge_into"]]
            for s in subs:
                if s["paper"] == pid:
                    s["paper"] = target
            del papers[pid]
            continue
        papers[pid].update({k: v for k, v in upd.items()})
    for np in NEW_PAPERS:
        pid = "p%d" % (len(key_to_id) + len(NEW_PAPERS) + 100 + NEW_PAPERS.index(np))
        papers[pid] = {"id": pid, "type": "Journal article", "override": "", "notes": "", **np}
    key_to_id = {p["key"]: p["id"] for p in papers.values()}

    for s in subs:
        s["journal"] = RENAME_JOURNAL.get(s["journal"], s["journal"])
    for key, journal, first in NEW_PLANNED:
        row = {"id": "s%d" % (len(subs) + 1), "paper": key_to_id[key], "journal": journal, "rating": "", "status": "Planned",
               "submitted": "", "decided": "", "notes": "From SK_Research_Updates_2026", "titleUsed": ""}
        if first:
            idx = next((i for i, s in enumerate(subs) if s["paper"] == row["paper"] and s["status"] == "Planned"), len(subs))
            subs.insert(idx, row)
        else:
            subs.append(row)
    for key, journal, field, value in SUB_FIXES:
        for s in subs:
            if s["paper"] == key_to_id[key] and s["journal"] == journal and s["status"] != "Planned":
                s[field] = value
    for s in subs:
        k = (papers[s["paper"]]["key"], s["journal"], s["status"])
        if k in LIVE:
            s["live"] = {"text": LIVE[k], "at": TODAY}
        # a plain ABDC letter in the old rating column is replaced by the official ABDC column
        if re.fullmatch(r"(ABDC\s*)?(A\*|A|B|C)", (s.get("rating") or "").strip()):
            s["rating"] = ""
        s["id"] = s["id"] if len(s["id"]) > 8 else str(uuid.uuid4())
    for p in papers.values():
        if len(p["id"]) <= 8:
            new = str(uuid.uuid4())
            for s in subs:
                if s["paper"] == p["id"]:
                    s["paper"] = new
            p["id"] = new
    papers = {p["id"]: p for p in papers.values()}
    key_to_id = {p["key"]: p["id"] for p in papers.values()}
    order = [key_to_id[k] for k in ORDER] + [pid for pid in papers if papers[pid]["key"] not in ORDER]
    build(seed, papers, subs, order, abdc_path, portals_path, out_xlsx, out_seed)


def build(seed, papers, subs, order, abdc_path, portals_path, out_xlsx, out_seed):
    # ABDC ratings and login links per journal
    r25, r22, abdc_full = load_abdc(abdc_path)
    portals = dict(re.findall(r'^\s*"([^"]+)":\s*"([^"]+)"', open(portals_path, encoding="utf-8").read(), re.M))
    journals = {}
    for s in subs:
        j = s["journal"]
        if j in journals:
            continue
        n = norm(ABDC_ALIAS.get(j, j))
        a25, official = r25.get(n, ("", ""))
        a22 = r22.get(n, "")
        journals[j] = {"abdc": a25 or ("Not listed" if not re.match(r"^(EPW|journals\.|link\.|meth\.|tandfonline)", j) else ""),
                       "alias": official if official and official != j else "",
                       "abdc22": a22 if a22 and a22 != a25 else "", "link": portals.get(app_norm(j), "")}

    # suggested next journals: run the app's own engine (suggest.js) with node
    tmp = {"papers": [{"id": pid, "key": p["key"], "title": p.get("title", ""), "override": p.get("override", "")} for pid, p in papers.items()],
           "subs": [{"paper": x["paper"], "journal": x["journal"], "status": x["status"], "submitted": x["submitted"]} for x in subs],
           "abdc": [list(a) for a in abdc_full]}
    js = ("const {rdSuggest}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const x=JSON.parse(d),o={};"
          "x.papers.forEach(p=>{o[p.id]=p.override?'':rdSuggest(p,x.subs.filter(s=>s.paper===p.id),x.abdc,5).map(j=>j.title+' ('+j.grade+')').join(' · ')});"
          "process.stdout.write(JSON.stringify(o))})")
    suggestions = json.loads(subprocess.run(["node", "-e", js, os.path.abspath("android/app/src/main/assets/suggest.js")], input=json.dumps(tmp),
                                            capture_output=True, text=True, check=True).stdout)

    # ---------- workbook ----------
    wb = openpyxl.Workbook()
    blue, pale, head_fill = "2F5D8A", "E3ECF5", PatternFill("solid", fgColor="2F5D8A")
    hf, thin = Font(bold=True, color="FFFFFF"), Side(style="thin", color="D9D6CF")
    paper_fill = PatternFill("solid", fgColor="EEF3F8")

    def header(ws, cols):
        for i, (h, w) in enumerate(cols, 1):
            c = ws.cell(1, i, h)
            c.font, c.fill = hf, head_fill
            c.alignment = Alignment(wrap_text=True, vertical="center")
            ws.column_dimensions[c.column_letter].width = w
        ws.row_dimensions[1].height = 30
        ws.freeze_panes = "C2"

    # Submissions (the master tracker: grouped by paper, spare rows under each paper)
    ws = wb.active
    ws.title = "Submissions"
    header(ws, [("Paper", 34), ("Journal", 38), ("ABDC 2025", 10), ("Other rating / index", 16), ("Status", 18),
                ("Date submitted", 13), ("Date of decision", 13), ("Days", 7), ("Notes", 40), ("Title used", 26),
                ("Manuscript ID", 16), ("Status on journal site", 24), ("Status checked", 13), ("App ID", 10), ("Updated", 16),
                ("ur rank", 6), ("paper|status", 6)])

    def put_formulas(r):
        ws.cell(r, 3, f'=IF(B{r}="","",IFERROR(VLOOKUP(B{r},Journals!$A:$B,2,FALSE),IFERROR(VLOOKUP(B{r},\'ABDC list\'!$A:$B,2,FALSE),"")))')
        ws.cell(r, 8, f'=IF(OR(F{r}="",E{r}="Planned"),"",IF(G{r}<>"",G{r}-F{r},TODAY()-F{r}))')
        ws.cell(r, 16, f'=IF(E{r}="Under review",COUNTIFS($E:$E,"Under review",$F:$F,"<"&F{r})+COUNTIFS($E$1:E{r},"Under review",$F$1:F{r},F{r}),"")')
        ws.cell(r, 17, f'=IF(B{r}="","",A{r}&"|"&E{r})')

    r = 2
    date = lambda s: datetime.date.fromisoformat(s) if s else None
    for pid in order:
        p = papers[pid]
        # paper heading row (no journal, so the app ignores it)
        ws.cell(r, 1, p["key"]).font = Font(bold=True, color=blue)
        ws.cell(r, 9, (p.get("title") or "") + (("  ·  " + p["authors"]) if p.get("authors") else "")).font = Font(italic=True, color="555555")
        for c in range(1, 18):
            ws.cell(r, c).fill = paper_fill
        r += 1
        ps = [s for s in subs if s["paper"] == pid]
        hist = sorted([s for s in ps if s["status"] != "Planned"], key=lambda s: (s["submitted"] or "9", s["decided"] or "9"))
        plan = [s for s in ps if s["status"] == "Planned"]
        for s in hist + plan:
            vals = [p["key"], s["journal"], None, s.get("rating", ""), s["status"], date(s["submitted"]), date(s["decided"]), None,
                    s.get("notes", ""), s.get("titleUsed", ""), s.get("msid", ""), (s.get("live") or {}).get("text", ""),
                    date((s.get("live") or {}).get("at", "")), s["id"], None]
            for c, v in enumerate(vals, 1):
                if v not in (None, ""):
                    ws.cell(r, c, v)
            put_formulas(r)
            r += 1
        spare = 2 if p.get("override") else 4
        for _ in range(spare):
            put_formulas(r)
            r += 1
    for extra in range(30):  # more room at the bottom
        put_formulas(r)
        r += 1
    last = r - 1
    for row in ws.iter_rows(min_row=2, max_row=last):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=c.column in (9, 10, 12))
            if c.column in (6, 7, 13):
                c.number_format = "d-mmm-yyyy"
    ws.column_dimensions["P"].hidden = ws.column_dimensions["Q"].hidden = True
    ws.column_dimensions["N"].hidden = ws.column_dimensions["O"].hidden = True
    dv_status = DataValidation(type="list", formula1='"' + ",".join(STATUSES) + '"', allow_blank=True)
    dv_paper = DataValidation(type="list", formula1="=Papers!$A$2:$A$200", allow_blank=True, showErrorMessage=False)
    dv_journal = DataValidation(type="list", formula1="=Journals!$A$2:$A$400", allow_blank=True, showErrorMessage=False)
    for dv, col in ((dv_status, "E"), (dv_paper, "A"), (dv_journal, "B")):
        ws.add_data_validation(dv)
        dv.add(f"{col}2:{col}{last}")
    rng = f"A2:O{last}"
    ws.conditional_formatting.add(rng, FormulaRule(formula=['$E2="Under review"'], fill=PatternFill("solid", fgColor="E3ECF5")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=['$E2="Rejected"'], font=Font(color="9A3B37")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=['$E2="Accepted"'], fill=PatternFill("solid", fgColor="DFF1E6")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=['OR($E2="Revision requested",$E2="Returned by office")'], fill=PatternFill("solid", fgColor="FBE9DC")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=['$E2="Planned"'], font=Font(color="6B6862")))

    # Papers
    pw = wb.create_sheet("Papers")
    header(pw, [("Paper", 34), ("Title", 60), ("Authors", 30), ("Type", 16), ("Override", 16), ("Notes", 40), ("Stage", 18),
                ("Current journal", 34), ("Sent", 7), ("Rejections", 10), ("Next in queue", 34), ("Suggested next journals", 70),
                ("App ID", 10), ("Updated", 16), ("wait rank", 6)])
    pw.freeze_panes = "B2"
    for i, pid in enumerate(order, 2):
        p = papers[pid]
        for c, v in enumerate([p["key"], p.get("title", ""), p.get("authors", ""), p.get("type", "Journal article"),
                               p.get("override", ""), p.get("notes", "")], 1):
            if v:
                pw.cell(i, c, v)
        pw.cell(i, 12, suggestions.get(pid, ""))
        pw.cell(i, 13, p["id"])
    for i in range(2, 201):
        A = f"A{i}"
        cnt = lambda st: f'COUNTIFS(Submissions!$A:$A,{A},Submissions!$E:$E,"{st}")'
        pw.cell(i, 7, f'=IF({A}="","",IF(E{i}<>"",E{i},IF({cnt("Accepted")}>0,"Accepted",IF({cnt("Revision requested")}>0,"Revision due",'
                      f'IF({cnt("Under review")}>0,"Under review",IF(I{i}>0,"Needs resubmission","Not yet submitted"))))))')
        pw.cell(i, 8, f'=IF({A}="","",IFERROR(INDEX(Submissions!$B:$B,MATCH({A}&"|Under review",Submissions!$Q:$Q,0)),""))')
        pw.cell(i, 9, f'=IF({A}="","",COUNTIFS(Submissions!$A:$A,{A},Submissions!$B:$B,"<>",Submissions!$E:$E,"<>Planned"))')
        pw.cell(i, 10, f'=IF({A}="","",{cnt("Rejected")})')
        pw.cell(i, 11, f'=IF({A}="","",IFERROR(INDEX(Submissions!$B:$B,MATCH({A}&"|Planned",Submissions!$Q:$Q,0)),""))')
        pw.cell(i, 15, f'=IF(OR(G{i}="Revision due",G{i}="Needs resubmission",G{i}="Not yet submitted"),'
                       f'COUNTIF($G$2:$G$200,"Revision due")*(G{i}<>"Revision due")+COUNTIF($G$2:$G$200,"Needs resubmission")*(G{i}="Not yet submitted")'
                       f'+COUNTIFS($G$2:G{i},G{i}),"")')
        for c in range(1, 16):
            pw.cell(i, c).alignment = Alignment(vertical="top", wrap_text=c in (2, 6, 12))
    pw.column_dimensions["O"].hidden = pw.column_dimensions["M"].hidden = pw.column_dimensions["N"].hidden = True
    dv_o = DataValidation(type="list", formula1='",Closed – rejected,Parked,Published,Withdrawn"', allow_blank=True)
    dv_t = DataValidation(type="list", formula1='"Journal article,EPW / short piece,Book chapter,Other"', allow_blank=True)
    pw.add_data_validation(dv_o); dv_o.add("E2:E200")
    pw.add_data_validation(dv_t); dv_t.add("D2:D200")

    # Journals
    jw = wb.create_sheet("Journals")
    header(jw, [("Journal", 46), ("ABDC 2025", 11), ("Name on ABDC list (if different)", 34), ("ABDC 2022 (if different)", 13),
                ("Other rating / index", 18), ("Login link", 44), ("Editorial office email", 28), ("Notes", 30)])
    jw.freeze_panes = "B2"
    for i, (j, v) in enumerate(sorted(journals.items(), key=lambda kv: kv[0].lower()), 2):
        jw.cell(i, 1, j)
        if v["alias"]:
            jw.cell(i, 3, v["alias"])
        if v["abdc22"]:
            jw.cell(i, 4, v["abdc22"])
        if v["link"]:
            jw.cell(i, 6, v["link"])
    for i in range(2, 401):
        jw.cell(i, 2, f'=IF(A{i}="","",IFERROR(VLOOKUP(IF(C{i}<>"",C{i},A{i}),\'ABDC list\'!$A:$B,2,FALSE),"Not listed"))')
    dv_j = DataValidation(type="list", formula1="=\'ABDC list\'!$A$2:$A$2700", allow_blank=True, showErrorMessage=False)
    jw.add_data_validation(dv_j); dv_j.add("C2:C400")

    # ABDC list (official 2025 Journal Quality List, current to September 2026)
    aw = wb.create_sheet("ABDC list")
    header(aw, [("Journal Title", 60), ("2025 rating", 10), ("FoR", 8), ("Publisher", 36)])
    aw.freeze_panes = "A2"
    for i, row in enumerate(abdc_full, 2):
        for c, v in enumerate(row, 1):
            aw.cell(i, c, v)
    aw.cell(1, 6, "Source: ABDC Journal Quality List 2025 (v3, current to September 2026), abdc.edu.au").font = Font(italic=True, color="6B6862")
    jw.conditional_formatting.add("B2:B400", CellIsRule(operator="equal", formula=['"Not listed"'], font=Font(color="8A8780")))

    # Dashboard
    dw = wb.create_sheet("Dashboard", 0)
    dw.sheet_view.showGridLines = False
    for col, w in zip("ABCDEFGHI", (2, 34, 34, 9, 13, 8, 26, 22, 2)):
        dw.column_dimensions[col].width = w
    dw["B2"] = "SK research submissions"
    dw["B2"].font = Font(bold=True, size=18, color=blue)
    dw["B3"] = '="As of "&TEXT(TODAY(),"d mmm yyyy")&"  ·  edit Submissions, Papers and Journals; this page updates itself"'
    dw["B3"].font = Font(color="6B6862")
    dw["G3"], dw["H3"] = "Chase editor after (days):", 90
    dw["H3"].font = Font(bold=True)
    tiles = [("B", "PAPERS TRACKED", '=COUNTIFS(Papers!$A$2:$A$200,"<>",Papers!$G$2:$G$200,"<>Parked",Papers!$G$2:$G$200,"<>Closed – rejected",Papers!$G$2:$G$200,"<>Withdrawn",Papers!$G$2:$G$200,"<>Published")'),
             ("C", "UNDER REVIEW", '=COUNTIF(Submissions!$E:$E,"Under review")'),
             ("E", "WAITING ON YOU", '=COUNTIF(Papers!$G$2:$G$200,"Revision due")+COUNTIF(Papers!$G$2:$G$200,"Needs resubmission")+COUNTIF(Papers!$G$2:$G$200,"Not yet submitted")'),
             ("G", "SUBMISSIONS SENT", '=COUNTIFS(Submissions!$B:$B,"<>",Submissions!$E:$E,"<>Planned",Submissions!$B$2:$B$2000,"<>Journal")-0'),
             ("H", "ACCEPTED", '=COUNTIF(Submissions!$E:$E,"Accepted")')]
    tiles[3] = ("G", "SUBMISSIONS SENT", '=SUMPRODUCT((Submissions!$B$2:$B$2000<>"")*(Submissions!$E$2:$E$2000<>"Planned"))')
    for col, label, f in tiles:
        dw[f"{col}5"], dw[f"{col}6"] = label, f
        dw[f"{col}5"].font = Font(bold=True, size=9, color="6B6862")
        dw[f"{col}6"].font = Font(bold=True, size=22, color=blue)
    dw["B9"] = "Under review now  (longest wait first)"
    dw["B9"].font = Font(bold=True, size=12, color=blue)
    for col, h in zip("BCDEFG", ("PAPER", "JOURNAL", "ABDC", "SUBMITTED", "DAYS", "CHECK")):
        dw[f"{col}10"] = h
        dw[f"{col}10"].font = Font(bold=True, size=9, color="6B6862")
        dw[f"{col}10"].border = Border(bottom=thin)
    for k in range(1, 26):
        rr = 10 + k
        m = f'MATCH({k},Submissions!$P:$P,0)'
        for col, src in zip("BCDE", "ABCF"):
            dw[f"{col}{rr}"] = f'=IFERROR(INDEX(Submissions!${src}:${src},{m}){"" if src == "F" else "&" + chr(34) * 2},"")'
        dw[f"E{rr}"].number_format = "d-mmm-yy"
        dw[f"F{rr}"] = f'=IFERROR(INDEX(Submissions!$H:$H,{m}),"")'
        dw[f"G{rr}"] = f'=IF(F{rr}="","",IF(F{rr}>=2*$H$3,"Overdue: chase editor",IF(F{rr}>=$H$3,"Check status","")))'
        dw[f"H{rr}"] = f'=IFERROR(INDEX(Submissions!$L:$L,{m})&"","")'
    dw["H10"] = "ON JOURNAL SITE"
    dw["H10"].font = Font(bold=True, size=9, color="6B6862")
    dw.conditional_formatting.add("G11:G35", CellIsRule(operator="equal", formula=['"Overdue: chase editor"'], font=Font(color="A8322F", bold=True)))
    dw.conditional_formatting.add("G11:G35", CellIsRule(operator="equal", formula=['"Check status"'], font=Font(color="B07A12")))
    dw["B38"] = "Waiting on you  (revisions first, then papers to resubmit, then not yet submitted)"
    dw["B38"].font = Font(bold=True, size=12, color=blue)
    for col, h in zip("BCD", ("PAPER", "STAGE", "")):
        dw[f"{col}39"] = h
        dw[f"{col}39"].font = Font(bold=True, size=9, color="6B6862")
    dw["E39"], dw["G39"] = "NEXT IN YOUR QUEUE", "SUGGESTED (ABDC)"
    dw["E39"].font = dw["G39"].font = Font(bold=True, size=9, color="6B6862")
    for k in range(1, 26):
        rr = 39 + k
        m = f'MATCH({k},Papers!$O:$O,0)'
        dw[f"B{rr}"] = f'=IFERROR(INDEX(Papers!$A:$A,{m})&"","")'
        dw[f"C{rr}"] = f'=IFERROR(INDEX(Papers!$G:$G,{m})&"","")'
        dw[f"E{rr}"] = f'=IFERROR(INDEX(Papers!$K:$K,{m})&"","")'
        dw[f"G{rr}"] = f'=IFERROR(INDEX(Papers!$L:$L,{m})&"","")'
        dw[f"G{rr}"].alignment = Alignment(wrap_text=False)

    # How to use
    hw = wb.create_sheet("How to use", 1)
    hw.column_dimensions["A"].width = 26
    hw.column_dimensions["B"].width = 110
    hw["A1"] = "How to use this master sheet"
    hw["A1"].font = Font(bold=True, size=16, color=blue)
    tips = [
        ("Submissions", "The master list, grouped by paper. Each paper has a shaded heading row, then its journals (history first, "
                        "then the current one, then the planned queue), then empty rows for future submissions."),
        ("After a rejection", "Change that row's Status to Rejected and fill Date of decision. Then use an empty row under the "
                              "paper: pick the Paper from the list, type or pick the Journal, set Status = Under review and the date."),
        ("A new journal to try later", "Add a row with Status = Planned (no dates). The first Planned row of a paper is its ‘Next in queue’."),
        ("ABDC rating", "Filled automatically from the Journals tab (official ABDC list, 2025 ratings). ‘Not listed’ = not on the "
                        "2025 list; the 2022 rating is shown there when it differs. New journal? Add it on the Journals tab."),
        ("Papers", "One row per paper: short name (must be unique), title, authors. Stage, current journal and counts are calculated."),
        ("Journals", "One row per journal: ABDC rating (automatic from the ABDC list tab), login link and editorial office email "
                     "(the app uses these too). If a journal shows ‘Not listed’ but is on the list under another name, pick that name "
                     "in ‘Name on ABDC list’."),
        ("Suggested next journals", "Papers tab: ABDC journals that fit each paper (same ABDC fields as the journals you chose, "
                                    "matching topic words, around the tier of the last journal). Refreshed on every app sync, or "
                                    "from the menu RD SK → Refresh suggested journals. Your own Planned queue always comes first."),
        ("Don't edit", "Grey/automatic columns (ABDC, Days) and the hidden columns (App ID, Updated, helpers) are managed for you."),
        ("Phone app", "Connect this Google Sheet to RD SK (More → Google Sheets sync). Changes on either side appear on the other."),
    ]
    for i, (a, b) in enumerate(tips, 3):
        hw.cell(i, 1, a).font = Font(bold=True)
        hw.cell(i, 2, b).alignment = Alignment(wrap_text=True, vertical="top")
        hw.row_dimensions[i].height = 44
    wb.active = 0
    wb.save(out_xlsx)

    # app seed in the same shape the app uses
    out = {"version": 1, "settings": seed["settings"], "papers": [papers[pid] for pid in order], "subs": subs, "portals": {},
           "abdc": {j: v["abdc"] for j, v in journals.items() if v["abdc"]}}
    for p in out["papers"]:
        p.setdefault("type", "Journal article"); p.setdefault("override", ""); p.setdefault("notes", "")
    with open(out_seed, "w", encoding="utf-8") as f:
        f.write("window.RD_SEED = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")
    listed = sum(1 for v in journals.values() if v["abdc"] not in ("", "Not listed"))
    print(f"papers={len(out['papers'])} submissions={len(subs)} journals={len(journals)} abdc_listed={listed} rows={last}")


if __name__ == "__main__":
    main(*sys.argv[1:7])
