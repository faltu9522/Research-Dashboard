# Research tracker (local website)

A small app that runs on your own computer. Nothing goes online.

## Start it
1. Install Python 3.8 or newer from python.org if you don't have it (Windows: tick "Add Python to PATH").
2. Copy this whole `app` folder to your computer.
3. Windows: double-click `run.bat`. Mac/Linux: run `./run.sh`.
4. Your browser opens at http://localhost:8765. Keep the black window open while you use it; close it to stop.

## Daily use
- **Waiting on you** lists papers no journal has right now, longest idle first. Click a tile at the top to jump to its list.
- Red and amber bars, a pulsing tile and a number on the browser tab ("(9) Research tracker") stay until you deal with the paper.
- Click a paper to see its history and queue. Buttons record "Submitted today", "Rejected", "Revision requested", "Revised & resubmitted".
- After a rejection the app offers the next journal in the queue.
- **+ New paper** adds a paper with an optional list of journals to try in order.
- If nothing has been logged for 10 days a banner reminds you (change in the gear menu).

## Your data
- Stored in `data/research.db`, with a daily backup in `data/backups`.
- Gear menu → "Download backup" saves everything as a JSON file; "Restore" loads one back.
- Starts pre-filled from your old spreadsheet (`seed.json`) the first time only.
