# RD SK – Research Dashboard (Android)

A phone app for tracking paper submissions, built from the *Research Dashboard* Excel workbook.

**Install:** download [`apk/RD-SK.apk`](apk/RD-SK.apk) on your Android phone (Android 7+), open it and allow
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
- **Excel in/out** – export to `.xlsx` (Papers + Submissions sheets, saved to Downloads), import the workbook's
  `.xlsx` or a `.json` backup.

Data is stored on the phone only. Use *More → Save backup* now and then.

## Rebuilding
- Seed data from a newer workbook: `python3 tools/excel_to_seed.py Research_Dashboard.xlsx android/app/src/main/assets/seed.js`
  (seed data is only used on first launch or after *Reset*; to load a new workbook on the phone use *Import*).
- Build: `cd android && ./gradlew assembleRelease` (needs the Android SDK), or run the *Build RD SK APK* GitHub
  Action. The APK is signed with `android/app/rdsk.keystore`, so new builds install over the old one and keep data.
