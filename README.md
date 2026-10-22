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
  journal emails in the sheet owner's Gmail (ScholarOne, Editorial Manager, publishers, label `RD-SK`, or mail to
  `<you>+rdsk@gmail.com`) with `assets/emailparse.js` (shared with the app), updates confidently matched
  submissions (status, dates, manuscript ID, desk vs after-review, reviewer count), logs every email on the *Emails*
  tab and decision letters with reviewer comments on *Decisions & reviews*; unclear ones wait in the app.
- **Excel in/out** – export to `.xlsx` (Papers + Submissions sheets, saved to Downloads), import the workbook's
  `.xlsx` or a `.json` backup.

- **Sync to GitHub** (*More → Sync to GitHub*) – commits `data/Research_Dashboard.xlsx` and
  `data/rdsk-backup.json` to this repo (branch `main` by default), automatically ~8 s after each change or
  with *Sync now*. *Load from GitHub* pulls the backup back onto a phone. Needs a fine-grained token limited
  to this repo with **Contents: Read and write**; the token stays on the phone and is never exported.

Data is stored on the phone; GitHub sync (or *More → Save backup*) keeps a copy off the phone.

## Rebuilding
- Seed data from a newer workbook: `python3 tools/excel_to_seed.py Research_Dashboard.xlsx android/app/src/main/assets/seed.js`
  (seed data is only used on first launch or after *Reset*; to load a new workbook on the phone use *Import*).
- Build: `cd android && ./gradlew assembleRelease` (needs the Android SDK), or run the *Build RD SK APK* GitHub
  Action. The APK is signed with `android/app/rdsk.keystore`, so new builds install over the old one and keep data.
