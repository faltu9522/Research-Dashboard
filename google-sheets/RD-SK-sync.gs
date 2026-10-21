/**
 * RD SK ↔ Google Sheets sync (two-way).
 *
 * Setup (once): open your Research Dashboard Google Sheet → Extensions → Apps Script → replace everything with this
 * file → Save → Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone → Deploy →
 * Authorize → copy the Web app URL into RD SK (More → Google Sheets sync).
 *
 * The app only changes the input columns of the Papers and Submissions sheets (the same ones you type in) plus a few
 * extra columns it adds at the right. Formula columns and the Dashboard are left alone.
 */

// Column numbers (A = 1). Input columns match the Research Dashboard workbook.
var P = { key: 1, title: 2, authors: 3, type: 4, override: 5, notes: 13, id: 16, updated: 17 };
var S = { paper: 1, journal: 2, rating: 3, status: 4, submitted: 5, decided: 6, notes: 8, titleUsed: 9,
          msid: 16, live: 17, liveAt: 18, id: 19, updated: 20 };
var P_HEAD = { 16: 'App ID', 17: 'Updated' };
var S_HEAD = { 16: 'Manuscript ID', 17: 'Status on journal site', 18: 'Status checked', 19: 'App ID', 20: 'Updated' };
var APP_SHEET = 'RD SK app';

function doGet() {
  return out(handle({}));
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return out(handle(body));
}

/** Records an edit time (and an ID) on rows you change by hand, so the newest edit wins when syncing. */
function onEdit(e) {
  var sh = e.range.getSheet(), name = sh.getName();
  var C = name === 'Papers' ? P : name === 'Submissions' ? S : null;
  if (!C || e.range.getRow() < 2 || e.range.getColumn() >= C.id) return;
  for (var r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
    sh.getRange(r, C.updated).setValue(new Date());
    var idCell = sh.getRange(r, C.id);
    if (!idCell.getValue()) idCell.setValue(Utilities.getUuid());
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
    var ps = ss.getSheetByName('Papers'), subs = ss.getSheetByName('Submissions');
    if (!ps || !subs) return { ok: false, error: "This sheet needs tabs called 'Papers' and 'Submissions'." };
    heads(ps, P_HEAD); heads(subs, S_HEAD);
    var pb = block(ps, P), sb = block(subs, S);

    // 1a. First connection keeping the sheet's data: only attach the phone's IDs (and its manuscript IDs / journal
    //     statuses where the sheet has none) to matching rows; nothing else in the sheet changes.
    if (body.link) {
      (body.papers || []).forEach(function (p) {
        var i = find(pb, P, '', function (row) { return str(row[P.key - 1]) === p.key; });
        if (i >= 0) pb.v[i][P.id - 1] = p.id;
      });
      (body.subs || []).forEach(function (s) {
        var i = find(sb, S, '', function (row) {
          return str(row[S.paper - 1]) === s.paper && norm(row[S.journal - 1]) === norm(s.journal) &&
            (day(row[S.submitted - 1], tz) === s.submitted || (!s.submitted && !day(row[S.submitted - 1], tz)));
        });
        if (i < 0) return;
        var row = sb.v[i];
        row[S.id - 1] = s.id;
        if (!str(row[S.msid - 1]) && s.msid) row[S.msid - 1] = s.msid;
        if (!str(row[S.live - 1]) && s.live) { row[S.live - 1] = s.live; row[S.liveAt - 1] = date(s.liveAt); }
      });
      body.papers = []; body.subs = []; body.deleted = [];
    }

    // 1b. Apply the phone's changes (newest edit wins; "overwrite" = the phone's copy wins everywhere).
    (body.papers || []).forEach(function (p) {
      var i = find(pb, P, p.id, function (row) { return str(row[P.key - 1]) === p.key || (p.oldKey && str(row[P.key - 1]) === p.oldKey); });
      if (i < 0) i = freeRow(pb, function (row) { return !str(row[P.key - 1]); });
      else if (!body.overwrite && updated(pb.v[i], P) > (p.mod || 0)) return;
      var row = pb.v[i];
      var old = str(row[P.key - 1]);
      row[P.key - 1] = p.key; row[P.title - 1] = p.title || ''; row[P.authors - 1] = p.authors || '';
      row[P.type - 1] = p.type || ''; row[P.override - 1] = p.override || ''; row[P.notes - 1] = p.notes || '';
      row[P.id - 1] = p.id; row[P.updated - 1] = new Date(p.mod || Date.now());
      if (old && old !== p.key) sb.v.forEach(function (r) { if (str(r[S.paper - 1]) === old) r[S.paper - 1] = p.key; });
    });
    (body.subs || []).forEach(function (s) {
      var i = find(sb, S, s.id, function (row) {
        return str(row[S.paper - 1]) === s.paper && norm(row[S.journal - 1]) === norm(s.journal) &&
          (day(row[S.submitted - 1], tz) === s.submitted || (str(row[S.status - 1]) === 'Planned' && s.status === 'Planned'));
      });
      if (i < 0) i = freeRow(sb, function (row) { return !str(row[S.paper - 1]) && !str(row[S.journal - 1]); });
      else if (!body.overwrite && updated(sb.v[i], S) > (s.mod || 0)) return;
      var row = sb.v[i];
      row[S.paper - 1] = s.paper; row[S.journal - 1] = s.journal; row[S.rating - 1] = s.rating || '';
      row[S.status - 1] = s.status || ''; row[S.submitted - 1] = date(s.submitted); row[S.decided - 1] = date(s.decided);
      row[S.notes - 1] = s.notes || ''; row[S.titleUsed - 1] = s.titleUsed || ''; row[S.msid - 1] = s.msid || '';
      row[S.live - 1] = s.live || ''; row[S.liveAt - 1] = date(s.liveAt);
      row[S.id - 1] = s.id; row[S.updated - 1] = new Date(s.mod || Date.now());
    });
    (body.deleted || []).forEach(function (id) {
      [[pb, P, [P.key, P.title, P.authors, P.type, P.override, P.notes]],
       [sb, S, [S.paper, S.journal, S.rating, S.status, S.submitted, S.decided, S.notes, S.titleUsed, S.msid, S.live, S.liveAt]]]
        .forEach(function (x) {
          var i = find(x[0], x[1], id, null);
          if (i >= 0) { x[2].forEach(function (c) { x[0].v[i][c - 1] = ''; }); x[0].v[i][x[1].id - 1] = ''; x[0].v[i][x[1].updated - 1] = ''; }
        });
    });

    // 2. Give every row an ID, then write back (formulas are kept).
    pb.v.forEach(function (r) { if (str(r[P.key - 1]) && !str(r[P.id - 1])) r[P.id - 1] = Utilities.getUuid(); });
    sb.v.forEach(function (r) { if ((str(r[S.paper - 1]) || str(r[S.journal - 1])) && !str(r[S.id - 1])) r[S.id - 1] = Utilities.getUuid(); });
    save(ps, pb); save(subs, sb);

    // 3. App settings (journal login links, editor emails, chase days).
    var app = appData(ss, body.app);

    // 4. Send everything back.
    return {
      ok: true, now: Date.now(), sheet: ss.getName(), app: app,
      papers: pb.v.filter(function (r) { return str(r[P.key - 1]); }).map(function (r) {
        return { id: str(r[P.id - 1]), key: str(r[P.key - 1]), title: str(r[P.title - 1]), authors: str(r[P.authors - 1]),
                 type: str(r[P.type - 1]), override: str(r[P.override - 1]), notes: str(r[P.notes - 1]) };
      }),
      subs: sb.v.filter(function (r) { return str(r[S.paper - 1]) || str(r[S.journal - 1]); }).map(function (r) {
        return { id: str(r[S.id - 1]), paper: str(r[S.paper - 1]), journal: str(r[S.journal - 1]), rating: str(r[S.rating - 1]),
                 status: str(r[S.status - 1]), submitted: day(r[S.submitted - 1], tz), decided: day(r[S.decided - 1], tz),
                 notes: str(r[S.notes - 1]), titleUsed: str(r[S.titleUsed - 1]), msid: str(r[S.msid - 1]),
                 live: str(r[S.live - 1]), liveAt: day(r[S.liveAt - 1], tz) };
      })
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------
function heads(sh, h) { for (var c in h) { var cell = sh.getRange(1, +c); if (cell.getValue() !== h[c]) cell.setValue(h[c]).setFontWeight('bold'); } }

/** Reads the whole sheet once: values plus formulas (so writing back keeps the formulas). */
function block(sh, C) {
  var rows = Math.max(sh.getLastRow() - 1, 1), cols = Math.max(sh.getLastColumn(), C.updated);
  var rg = sh.getRange(2, 1, rows, cols);
  return { v: rg.getValues(), f: rg.getFormulas(), rows: rows, cols: cols, added: 0, used: {} };
}

function save(sh, b) {
  var data = b.v.map(function (r, i) { return r.map(function (x, j) { var f = b.f[i] && b.f[i][j]; return f ? f : x; }); });
  sh.getRange(2, 1, data.length, b.cols).setValues(data);
  if (b.added) { // new rows past the end: copy formulas down from row 2
    var first = 2 + data.length - b.added;
    b.f[0].forEach(function (f, j) { if (f) sh.getRange(2, j + 1).copyTo(sh.getRange(first, j + 1, b.added, 1)); });
  }
}

function find(b, C, id, natural) {
  if (id) for (var i = 0; i < b.v.length; i++) if (str(b.v[i][C.id - 1]) === id) return i;
  if (natural) for (var k = 0; k < b.v.length; k++) if (!str(b.v[k][C.id - 1]) && natural(b.v[k])) return k;
  return -1;
}

function freeRow(b, isFree) {
  for (var i = 0; i < b.v.length; i++) if (isFree(b.v[i]) && !b.used[i]) { b.used[i] = 1; return i; }
  var row = []; for (var j = 0; j < b.cols; j++) row.push('');
  b.v.push(row); b.f.push(row.map(function () { return ''; })); b.added++;
  return b.v.length - 1;
}

function appData(ss, incoming) {
  var sh = ss.getSheetByName(APP_SHEET);
  if (!sh) { sh = ss.insertSheet(APP_SHEET); sh.hideSheet(); sh.getRange(1, 1, 1, 2).setValues([['setting', 'value (JSON)']]); }
  var cur = {};
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues();
  vals.slice(1).forEach(function (r) { try { cur[r[0]] = JSON.parse(r[1]); } catch (e) {} });
  if (incoming) {
    ['portals', 'contacts'].forEach(function (k) { if (incoming[k]) cur[k] = Object.assign({}, cur[k] || {}, incoming[k]); });
    if (incoming.chaseDays) cur.chaseDays = incoming.chaseDays;
    var rows = [['setting', 'value (JSON)']];
    Object.keys(cur).forEach(function (k) { rows.push([k, JSON.stringify(cur[k])]); });
    sh.clearContents(); sh.getRange(1, 1, rows.length, 2).setValues(rows);
  }
  return cur;
}

function str(x) { return x === null || x === undefined ? '' : String(x).trim(); }
function norm(x) { return str(x).toLowerCase().replace(/\s+/g, ' '); }
function updated(row, C) { var u = row[C.updated - 1]; return u instanceof Date ? u.getTime() : (+u || 0); }
function day(x, tz) {
  if (x instanceof Date) return Utilities.formatDate(x, tz, 'yyyy-MM-dd');
  var s = str(x); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}
function date(s) { if (!s) return ''; var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
