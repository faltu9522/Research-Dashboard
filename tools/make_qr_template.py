"""Build excel/RD-SK-New-Submissions.xlsx: type new submissions on a laptop, get a QR code per row to scan in RD SK.

Usage: python3 tools/make_qr_template.py android/app/src/main/assets/seed.js excel/RD-SK-New-Submissions.xlsx
"""
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

STATUSES = ["Planned", "Under review", "Revision requested", "Revision resubmitted", "Rejected",
            "Returned by office", "Accepted", "Withdrawn"]
ROWS = 200
BLUE, PALE, GREY = "2F5D8A", "E3ECF5", "6B6862"


def link_formula(r):
    enc = lambda c: f'_xlfn.ENCODEURL({c}{r})'
    date = f'YEAR(G{r})&"-"&TEXT(MONTH(G{r}),"00")&"-"&TEXT(DAY(G{r}),"00")'
    status = f'IF(F{r}="",IF(G{r}="","Planned","Under review"),F{r})'
    opt = lambda c, k: f'IF({c}{r}="","","&{k}="&{enc(c)})'
    return (f'=IF(OR(A{r}="",D{r}=""),"","rdsk://add?p="&{enc("A")}&"&j="&{enc("D")}'
            f'&"&s="&_xlfn.ENCODEURL({status})&IF(G{r}="","","&d="&{date})'
            f'&{opt("E", "r")}&{opt("H", "m")}&{opt("I", "n")}&{opt("B", "t")}&{opt("C", "a")}&{opt("J", "l")})')


def main(seed_path, out):
    seed = json.loads(open(seed_path, encoding="utf-8").read().split("=", 1)[1].rstrip().rstrip(";"))
    wb = Workbook()
    thin = Side(style="thin", color="D9D6CF")
    head_font, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor=BLUE)

    # --- New submissions ---
    ws = wb.active
    ws.title = "New submissions"
    heads = [("Paper (short name)", 34), ("Paper title (new papers only)", 34), ("Authors (new papers only)", 22),
             ("Journal", 30), ("Rating / index", 12), ("Status", 16), ("Date submitted", 14), ("Manuscript ID", 16),
             ("Notes", 24), ("Login link (optional)", 26), ("App link (automatic)", 30), ("QR code (automatic)", 26)]
    for i, (h, w) in enumerate(heads, 1):
        c = ws.cell(1, i, h)
        c.font, c.fill = head_font, head_fill
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[c.column_letter].width = w
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "B2"
    auto_fill = PatternFill("solid", fgColor=PALE)
    for r in range(2, ROWS + 2):
        ws.row_dimensions[r].height = 150
        for col in range(1, 13):
            c = ws.cell(r, col)
            c.alignment = Alignment(wrap_text=True, vertical="top")
            c.border = Border(bottom=thin)
        ws.cell(r, 7).number_format = "d-mmm-yyyy"
        k = ws.cell(r, 11, link_formula(r))
        k.font, k.fill = Font(size=8, color=GREY), auto_fill
        q = ws.cell(r, 12, f'=IF(K{r}="","",_xlfn.IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data="&_xlfn.ENCODEURL(K{r})))')
        q.fill = auto_fill
        q.alignment = Alignment(horizontal="center", vertical="center")
    example = ["Who Spoke? Attribution Distortion and the Split Production Format of AI-Assisted Communication", "", "",
               "Journal of Pragmatics", "Q1", "Under review", None, "", "Example row: delete or overwrite", "", None, None]
    import datetime
    example[6] = datetime.date(2026, 10, 21)
    for i, v in enumerate(example[:10], 1):
        if v not in ("", None):
            ws.cell(2, i, v)

    dv_paper = DataValidation(type="list", formula1=f"=Papers!$A$2:$A${len(seed['papers']) + 1}", allow_blank=True,
                              showErrorMessage=False)
    dv_paper.promptTitle, dv_paper.prompt = "Paper", "Pick an existing paper, or type a new short name"
    dv_status = DataValidation(type="list", formula1='"' + ",".join(STATUSES) + '"', allow_blank=True)
    dv_date = DataValidation(type="date", operator="greaterThan", formula1="36526", allow_blank=True)
    dv_date.errorTitle, dv_date.error = "Date", "Enter a date, e.g. 21-Oct-2026"
    for dv, rng in ((dv_paper, "A2:A%d"), (dv_status, "F2:F%d"), (dv_date, "G2:G%d")):
        ws.add_data_validation(dv)
        dv.add(rng % (ROWS + 1))

    # --- Send to phone (all links at once, no QR needed) ---
    s2 = wb.create_sheet("Send to phone")
    s2["A1"] = "All app links (copy cell A3, send it to yourself on WhatsApp/email, then Share → RD SK on the phone)"
    s2["A1"].font = Font(bold=True, size=12)
    s2["A3"] = f"=_xlfn.TEXTJOIN(CHAR(10),TRUE,'New submissions'!K2:K{ROWS + 1})"
    s2["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    s2.column_dimensions["A"].width = 140
    s2.row_dimensions[3].height = 300

    # --- Papers (for the dropdown) ---
    s3 = wb.create_sheet("Papers")
    for i, h in enumerate(["Paper (short name)", "Current title", "Authors"], 1):
        c = s3.cell(1, i, h)
        c.font, c.fill = head_font, head_fill
    for r, p in enumerate(seed["papers"], 2):
        s3.cell(r, 1, p["key"]); s3.cell(r, 2, p["title"]); s3.cell(r, 3, p["authors"])
    for col, w in zip("ABC", (50, 80, 30)):
        s3.column_dimensions[col].width = w

    # --- How to use ---
    s4 = wb.create_sheet("How to use", 0)
    s4.column_dimensions["A"].width = 26
    s4.column_dimensions["B"].width = 100
    s4["A1"] = "RD SK · New submissions"
    s4["A1"].font = Font(bold=True, size=16, color=BLUE)
    tips = [
        ("1. Fill a row", "On ‘New submissions’, one row per submission: pick the Paper from the list (or type a new short "
                          "name and fill its title/authors), type the Journal, choose a Status and the Date submitted. "
                          "Manuscript ID, rating, notes and login link are optional."),
        ("2. QR appears", "The App link and QR code columns fill in by themselves (Microsoft 365 Excel, online)."),
        ("3. Scan on phone", "RD SK → Under review → 📷 Scan QR (or + → 📷 Scan QR). Check the entry and tap Add."),
        ("Many at once", "No scanning needed: copy cell A3 on ‘Send to phone’, send it to yourself (WhatsApp, email…), then "
                         "on the phone Share → RD SK (or copy it and tap 📋 Paste an email). All rows are added in one go."),
        ("Updating a row", "Same paper + journal updates the existing entry (e.g. a ‘Planned’ journal becomes ‘Under "
                           "review’), so you can also use this to record a decision: set Status and the date."),
        ("Privacy", "The QR images are drawn by the free service api.qrserver.com, which receives the row's link "
                    "(paper short name, journal, notes). If you'd rather not, leave the QR column alone and use "
                    "‘Send to phone’ instead, which never leaves your devices."),
        ("Older Excel", "IMAGE needs Microsoft 365. On older Excel the App link column still works for ‘Send to phone’."),
    ]
    for r, (a, b) in enumerate(tips, 3):
        s4.cell(r, 1, a).font = Font(bold=True)
        s4.cell(r, 2, b).alignment = Alignment(wrap_text=True, vertical="top")
        s4.row_dimensions[r].height = 48
    wb.active = 1
    wb.save(out)
    print("saved", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
