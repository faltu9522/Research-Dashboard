# RD SK – Research Dashboard (Android)

A phone app for tracking paper submissions, built from the *Research Dashboard* Excel workbook.

**Install:** download [`apk/RD-SK.apk`](apk/RD-SK.apk) on your Android phone (Android 7+, ~120 KB), open it and allow
"Install unknown apps" for your browser/file manager when asked.

## What it does
- **Dashboard** – the same tiles as the workbook (papers tracked, waiting on you, under review, revisions due,
  submissions sent, accepted), the "under review now" list (longest wait first, with *Check status* / *Overdue:
  chase editor* flags) and the "waiting on you" list.
- **Open journal login ↗** on every submission that is under review (or revision requested) – opens that
  journal's ScholarOne / Editorial Manager / T&F login page in your browser. Built-in links are in
  `android/app/src/main/assets/portals.js`; you can set your own link per journal inside the app.
- **Quick updates** – *Record decision* (rejected, revision requested, accepted…), *Mark submitted today* on a
  planned journal, *Submit to <next in queue> today* and *Resubmit revision today* on a paper, reorder a paper's
  journal queue, add/edit/delete papers and submissions.
- **Reminders** – a notification around 9 am when a submission reaches the chase limit (and again at twice
  it), plus a weekly nudge when nothing has been recorded for 7 days.
- **✉ Email editor** – on overdue submissions: opens your email app with a polite status enquiry filled in
  (title, manuscript ID, journal, submission date, days waiting). Add the manuscript ID and editorial office
  email on the submission; set your sign-off name under *More*.
- **Stats & insights** – acceptance rate, quick (likely desk) rejections, median time to decision after review,
  submissions and decisions per quarter, outcomes, per-journal speed from your own history, and per-paper totals.
- **🔄 Check all statuses** (Under review tab) – opens each journal's submission site in an in-app browser;
  you sign in yourself (the phone's password manager can fill it in) and the app reads the Status column of
  your Author Dashboard (ScholarOne / Editorial Manager), shows it on each card with the check date, and flags
  changes. Passwords are never stored by the app.
- **Update from an email** – share a journal email (or selected text) to RD SK, or tap *Paste an editor's
  email*: the app matches the submission (manuscript ID, journal, title) and guesses the outcome for you to confirm.
- **📷 Scan QR / add from links** – `excel/RD-SK-New-Submissions.xlsx` (laptop) builds an `rdsk://add?…` link and a
  QR code for each new submission; scan it in the app, or send the *Send to phone* sheet's links to yourself and
  Share → RD SK to add many at once. Same paper + journal updates the existing row.
- **🔗 Set login link** – for journals without a built-in login page, with a *Find it* search helper.
- **Google Sheets sync (two-way)** – put the workbook in Google Sheets, paste `google-sheets/RD-SK-sync.gs` into
  *Extensions → Apps Script*, deploy it as a web app (Execute as: Me, Access: Anyone) and paste its URL into
  *More → Google Sheets sync*. The app writes only the input columns (plus Manuscript ID, journal-site status and
  ID/Updated columns at the right); formulas and the Dashboard tab are untouched. Newest edit wins per row.
  `android/app/src/main/assets/gscript.js` embeds the same script for the in-app *Copy the script* button
  (regenerate it if you change the .gs file).
- **Master sheet** – `excel/RD-SK-Master.xlsx` (built by `tools/build_master.py` from the app data, the user's
  SK_Research_Updates_2026.xlsx and the official ABDC list): Dashboard, Submissions grouped by paper with spare rows,
  Papers (stage, current journal, queue, suggested next journals), Journals (ABDC 2025 by formula, login links,
  editor emails) and the full ABDC list tab. Upload it to Google Drive as the Google Sheet the app syncs with.
- **ABDC & suggestions** – the ABDC 2025 Journal Quality List (v3, current to Sept 2026) is embedded
  (`assets/abdc.js`); `assets/suggest.js` recommends next journals per paper (same ABDC fields, topic words, tier).
  The sheet script embeds the same engine (`python3 tools/make_gscript.py` after editing suggest.js).
- **Journal emails (Gmail)** – in the sheet: menu *RD SK → Turn on email import*. Every 15 minutes the script reads
  journal emails (received from 1 Oct 2026 on; script property `EMAIL_FROM_DATE` changes it) in the sheet owner's Gmail (ScholarOne, Editorial Manager, publishers, label `RD-SK`, or mail to
  `<you>+rdsk@gmail.com`) with `assets/emailparse.js` (shared with the app), updates confidently matched
  submissions (status, dates, manuscript ID, desk vs after-review, reviewer count), logs every email on the *Emails*
  tab and decision letters with reviewer comments on *Decisions & reviews*; unclear ones wait in the app. Submissions decided
  before that date are never changed. *RD SK → Repair* undoes all import changes and re-reads the emails.
- **💡 Research insights** – in the sheet: menu *RD SK → Turn on daily research insights*. Every morning the script
  pulls the last 5 weeks of articles from ~320 journals (`assets/watchlist.js`: ABDC A*/A/B in the user's areas, relevant
  FT50, and every journal the user has used; built by `tools/build_watchlist.py`) via the Crossref API, ranks them against
  the user's papers (`assets/insights.js`) and writes 5 to the *Research insights* tab with DOI, why it matters and a
  next-study idea. With *Set Claude API key* the script asks `claude-opus-5-5` to choose the 5 from a shortlist of 15 and
  write the ideas (structured JSON output, `fallbacks: "default"`); any failure falls back to the built-in ideas.
  **Free alternative:** *Set free Gemini API key* (Google AI Studio, no card) uses a free Gemini Flash model for the same
  job (Gemini is tried first when both keys are set). On Google's free tier, submitted content may be used to improve
  Google's products. Without any key, the built-in ideas are used (always free).
- **Excel in/out** – export to `.xlsx` (Papers + Submissions sheets, saved to Downloads), import the workbook's
  `.xlsx` or a `.json` backup.

- **Sync to GitHub** (*More → Sync to GitHub*) – commits `data/Research_Dashboard.xlsx` and
  `data/rdsk-backup.json` to this repo (branch `main` by default), automatically ~8 s after each change or
  with *Sync now*. *Load from GitHub* pulls the backup back onto a phone. Needs a fine-grained token limited
  to this repo with **Contents: Read and write**; the token stays on the phone and is never exported.

- **Ask AI** (tab) – pick a paper and its approach (conceptual, literature review, empirical qualitative / quantitative /
  mixed), then ask for fresh journal recommendations, where to go after the last rejection, whether a journal fits, a
  cover letter, or anything else. RD SK adds the paper's full history, its shortlist, matching ABDC 2025 journals and what
  each journal published recently (Crossref titles), so answers rest on real data. *Ask here* uses the sheet's free Gemini
  key (Google Search grounding when available; Claude key as fallback) and logs answers on the sheet's *AI chat* tab;
  *Ask in Gemini app* copies the question for the Gemini app (e.g. a Gemini Pro subscription) and lets you paste the
  answer back. Answers come back after a reinstall with the restore link.
- **Replace all data** (sheet menu *RD SK → Replace all papers and submissions with the Sheet 2 record*) – wipes
  Papers and Submissions and writes the clean record in `data/current-data.json` (made from Sheet 2 of
  SK_Research_Updates_2026.xlsx). Journals, ABDC list, email log, insights, settings, triggers and the web-app link
  stay. Phones on v2.8+ drop their old copy on the next sync; emails received before the replace change nothing.

Data is stored on the phone; GitHub sync (or *More → Save backup*) keeps a copy off the phone.

## Google sign-in setup (one time, free, ~15 minutes)
RD SK signs in with Google and keeps its master sheet in your own Drive. It asks only for **drive.file** (access to
the files RD SK creates), so the rest of your Drive stays private. Google needs to know the app once:

1. Open <https://console.cloud.google.com>, signed in with the account that should hold the sheet (the one that gets
   your journal emails), and create a project, e.g. **RD SK**.
2. **APIs & Services → Library**: enable **Google Sheets API** and **Google Drive API**.
3. **Google Auth Platform** (OAuth consent screen) → *Get started*: app name **RD SK**, your email as support and
   contact email, audience **External** → *Create*.
4. **Data access → Add or remove scopes**: tick `.../auth/drive.file` → *Update* → *Save*.
5. **Audience → Publish app** (status *In production*). drive.file is a non-sensitive permission, so no Google
   review should be needed. (If you stay in *Testing*, add yourself as a test user; Google then asks you to sign in
   again every 7 days.)
6. **Clients → Create client → Android**: package name `com.sk.rd`, SHA-1 certificate fingerprint
   `A5:16:32:A3:02:C3:E4:C1:BC:F6:EF:FA:07:12:CB:F9:BB:C9:43:C3` → *Create*. There is no secret to copy.
7. In the app: **More → Google account → Sign in with Google**, pick the account, allow access, then **Create my RD SK
   sheet** (your current data, including what's in a web-app sheet, is copied in). After a reinstall or on another
   phone: sign in and pick the sheet.
8. Optional, once: **More → Email import & daily insights** shows how to paste the helper script into the new sheet
   (Extensions → Apps Script → paste → Save → RD SK menu → turn on email import / daily insights). No deployment.
9. **More → Ask AI**: paste a free Gemini key (aistudio.google.com/apikey) for *Ask here*.

## Rebuilding
- Clean record from a new tracker: `python3 tools/sheet2_import.py SK_Research_Updates_2026.xlsx data/current-data.json`
  (yellow + date = under review, yellow without date = planned, red = earlier attempt, other journals = shortlist in
  the paper's notes), then `python3 tools/build_master.py android/app/src/main/assets/seed.js data/current-data.json
  ABDC-JQL-2025.xlsx android/app/src/main/assets/portals.js excel/RD-SK-Master.xlsx android/app/src/main/assets/seed.js`
  and `python3 tools/make_gscript.py`.
- Seed data from a newer workbook: `python3 tools/excel_to_seed.py Research_Dashboard.xlsx android/app/src/main/assets/seed.js`
  (seed data is only used on first launch or after *Reset*; to load a new workbook on the phone use *Import*).
- Build: `cd android && ./gradlew assembleRelease` (needs the Android SDK), or run the *Build RD SK APK* GitHub
  Action. The APK is signed with `android/app/rdsk.keystore`, so new builds install over the old one and keep data.

## Licence

RD SK is free and open source under the [MIT License](LICENSE).

Bundled third-party parts keep their own terms:
- [jsQR](https://github.com/cozmo/jsQR) (QR decoding, `assets/jsQR.min.js`): Apache License 2.0.
- ABDC Journal Quality List 2025 (`assets/abdc.js`, the *ABDC list* tab): data © Australian Business Deans Council,
  from [abdc.edu.au](https://abdc.edu.au/abdc-journal-quality-list/); included for reference, not covered by the MIT licence.
- Research insights use the free [Crossref REST API](https://api.crossref.org) (metadata, CC0).
