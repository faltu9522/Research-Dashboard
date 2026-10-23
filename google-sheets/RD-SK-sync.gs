/**
 * RD SK ↔ Google Sheets sync (two-way) + suggested next journals + journal emails from Gmail.
 *
 * Setup (once): open your RD SK master Google Sheet → Extensions → Apps Script → replace everything with this file →
 * Save → Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone → Deploy → Authorize →
 * copy the Web app URL into RD SK (More → Google Sheets sync).
 *
 * Columns are found by their header names, so you can reorder or add columns. The app only changes the columns you
 * type in (and Manuscript ID, Status on journal site, Status checked, App ID, Updated, Suggested next journals).
 * Formula columns, the Dashboard and the ABDC list are left alone.
 *
 * Email import (optional): reload the sheet, then menu RD SK → Turn on email import. Every 15 minutes the script reads
 * journal emails (from 1 Oct 2026 on, see EMAIL_FROM_DATE) in this Google account's Gmail (ScholarOne, Editorial Manager, publishers, the label "RD-SK", or mail
 * sent to <you>+rdsk@gmail.com), updates the matching submission when it is sure, logs every email on the Emails tab
 * and every decision letter (with reviewer comments) on the "Decisions & reviews" tab. Unclear emails wait for you
 * in the app.
 *
 * Research insights (optional): menu RD SK → Turn on daily research insights. Written gap ideas come from a free Gemini key
 * (RD SK → Set free Gemini API key) or, if you prefer, a paid Claude key; without a key, built-in ideas are used.
 *
 * MIT License (see LICENSE in the RD SK repository).
 */

var PAPER_COLS = { key: /^paper/i, title: /^(current |full )?title$/i, authors: /^authors?$/i, type: /^type$/i,
  override: /^override/i, notes: /^notes?$/i, suggest: /^suggested next/i, id: /^app id$/i, updated: /^updated$/i, approach: /^approach$/i };
var SUB_COLS = { paper: /^paper$/i, journal: /^journal$/i, abdc: /^abdc/i, rating: /rating|index/i, status: /^status$/i,
  submitted: /^(date submitted|date of submission)/i, decided: /^date of decision/i, notes: /^notes?$/i,
  titleUsed: /^title used/i, msid: /^manuscript id/i, live: /^status on journal/i, liveAt: /^status checked/i,
  dtype: /^decision type/i, id: /^app id$/i, updated: /^updated$/i };
var JOURNAL_COLS = { journal: /^journal$/i, abdc: /^abdc 2025/i, link: /^login link/i, email: /email/i };
var ADD_PAPER = { suggest: 'Suggested next journals', id: 'App ID', updated: 'Updated', approach: 'Approach' };
var ADD_SUB = { msid: 'Manuscript ID', live: 'Status on journal site', liveAt: 'Status checked', dtype: 'Decision type', id: 'App ID', updated: 'Updated' };
// Emails are read only from this date on, and submissions already decided before it are never changed.
// (Change it with File → Project properties → Script properties: EMAIL_FROM_DATE = yyyy-mm-dd.)
var EMAIL_FROM_DEFAULT = '2026-10-01';
function emailFromDate() { return PropertiesService.getScriptProperties().getProperty('EMAIL_FROM_DATE') || EMAIL_FROM_DEFAULT; }
var EMAILS_SHEET = 'Emails', DECISIONS_SHEET = 'Decisions & reviews', MAIL_LABEL = 'RD-SK';
var EMAIL_HEAD = ['Received', 'From', 'Subject', 'Paper', 'Journal', 'Detected', 'Decision type', 'Reviews', 'Manuscript ID', 'Action', 'Gmail link', 'Message ID', 'Undo data'];
var DECISION_HEAD = ['Decision date', 'Paper', 'Journal', 'Decision', 'Decision type', 'Reviews', 'Manuscript ID', 'Decision letter & reviewer comments', 'Gmail link', 'Message ID'];
var JOURNAL_SENDERS = ['manuscriptcentral.com', 'scholarone.com', 'editorialmanager.com', 'ariessys.com', 'aries-mail.com',
  'tandfonline.com', 'taylorandfrancis.com', 'sagepub.com', 'sagepub.co.uk', 'elsevier.com', 'springernature.com', 'springer.com',
  'wiley.com', 'emerald.com', 'emeraldgrouppublishing.com', 'oup.com', 'cambridge.org', 'epw.in', 'ieee.org', 'informs.org'];
var APP_SHEET = 'RD SK app', ABDC_SHEET = 'ABDC list';

function doGet() { return out(handle({})); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return out(body.ask ? aiAsk(body.ask) : handle(body));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RD SK')
    .addItem('Refresh suggested journals', 'refreshSuggestions')
    .addSeparator()
    .addItem('Turn on email import (every 15 min)', 'turnOnEmailImport')
    .addItem('Import journal emails now', 'importEmailsNow')
    .addItem('Turn off email import', 'turnOffEmailImport')
    .addItem('Repair: undo email changes and re-read emails', 'repairEmailImport')
    .addSeparator()
    .addItem("Get today's research insights now", 'insightsNow')
    .addItem('Turn on daily research insights (7 am)', 'turnOnDailyInsights')
    .addItem('Turn off daily research insights', 'turnOffDailyInsights')
    .addItem('Set free Gemini API key for written gap ideas', 'setGeminiKey')
    .addItem('Set Claude API key for written gap ideas (paid, optional)', 'setClaudeKey')
    .addSeparator()
    .addItem('Replace all papers and submissions with the Sheet 2 record', 'replaceAllData')
    .addToUi();
}

function refreshSuggestions() {
  var r = handle({});
  SpreadsheetApp.getActive().toast(r.ok ? 'Suggested next journals updated.' : r.error, 'RD SK');
}

// ---------- replace everything with one clean record (Sheet 2 of SK_Research_Updates_2026) ----------
/** Data epoch: changes when the data is replaced, so phones drop their old copy instead of sending it back. */
function dataEpoch() { return PropertiesService.getScriptProperties().getProperty('DATA_EPOCH') || ''; }
function dataReplacedAt() { var v = PropertiesService.getScriptProperties().getProperty('DATA_REPLACED_AT'); return v ? new Date(v) : null; }

function replaceAllData() {
  var ui = SpreadsheetApp.getUi(), d = RD_CURRENT;
  var cur = d.subs.filter(function (s) { return s.status === 'Under review'; }).length;
  if (ui.alert('Replace all data', 'This removes every paper and submission now in Papers and Submissions and writes the record from ' +
      d.source + ' instead: ' + d.papers.length + ' papers, ' + cur + ' under review.\n\nJournals, the ABDC list, the email log, ' +
      'insights, your settings and the app link all stay. Emails received before now will not change the new data. Continue?',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var keep = ui.alert('Earlier attempts', 'Keep the earlier attempts from Sheet 2 (red rows: journals that already rejected a paper) ' +
      'as history under each paper? They also stop the suggested journals from offering a journal you already tried.\n\n' +
      'Yes = keep them as Rejected rows.  No = only current and planned submissions.', ui.ButtonSet.YES_NO) === ui.Button.YES;
  var r = replaceData(d, keep);
  ui.alert('Done', r.papers + ' papers and ' + r.subs + ' submissions written.\n\nNow open RD SK (version 2.8 or newer) and tap ' +
    'More → Google Sheets sync → Sync now. The phone replaces its old copy with this data.', ui.ButtonSet.OK);
}

function replaceData(d, keepHistory) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = SpreadsheetApp.getActive(), now = new Date();
    var ps = ss.getSheetByName('Papers'), subsSh = ss.getSheetByName('Submissions');
    var P = cols(ps, PAPER_COLS, ADD_PAPER), S = cols(subsSh, SUB_COLS, ADD_SUB);
    var pb = block(ps, P), sb = block(subsSh, S);
    var pf = ['key', 'title', 'authors', 'type', 'override', 'notes', 'suggest', 'id', 'updated', 'approach'];
    var sf = ['paper', 'journal', 'rating', 'status', 'submitted', 'decided', 'notes', 'titleUsed', 'msid', 'live', 'liveAt', 'dtype', 'id', 'updated'];
    var blank = function (b, C, fields, row) { fields.forEach(function (f) { if (C[f]) { b.v[row][C[f] - 1] = ''; b.f[row][C[f] - 1] = ''; } }); };
    var at = function (b, i) { while (b.v.length <= i) freeRow(b, function () { return false; }, -1); return b.v[i]; };
    pb.v.forEach(function (r, i) { blank(pb, P, pf, i); });
    sb.v.forEach(function (r, i) { blank(sb, S, sf, i); });

    var key = {}, list = d.subs.filter(function (s) { return keepHistory || !/^(Rejected|Revision resubmitted)$/.test(s.status); });
    d.papers.forEach(function (p, i) {
      key[p.id] = p.key;
      var row = at(pb, i), set = function (f, v) { if (P[f]) row[P[f] - 1] = v; };
      set('key', p.key); set('title', p.title); set('authors', p.authors); set('type', p.type); set('override', p.override || '');
      set('notes', p.notes || ''); set('id', p.id); set('updated', now);
    });
    var n = 0, heads = [];
    d.papers.forEach(function (p) {
      var head = at(sb, n);                                  // heading row: paper name, title and authors (no journal)
      head[S.paper - 1] = p.key;
      if (S.notes) head[S.notes - 1] = p.title + (p.authors ? '  ·  ' + p.authors : '');
      heads.push(n++);
      list.filter(function (s) { return s.paper === p.id; }).forEach(function (s) {
        var row = at(sb, n++), set = function (f, v) { if (S[f]) row[S[f] - 1] = v; };
        set('paper', p.key); set('journal', s.journal); set('rating', s.rating || ''); set('status', s.status);
        set('submitted', date(s.submitted)); set('decided', date(s.decided)); set('notes', s.notes || ''); set('titleUsed', s.titleUsed || '');
        set('id', s.id); set('updated', now);
      });
      n += p.override ? 2 : 4;                               // spare rows for the next submissions
    });
    at(sb, n + 30);
    save(ps, pb); save(subsSh, sb);
    fillFormulas(subsSh, S, sf, sb.v.length);
    // shade the heading rows (and only them)
    var width = Math.max(S.updated || 1, S.id || 1, 15), bg = [], fw = [], fc = [];
    for (var i = 0; i < sb.v.length; i++) {
      var h = heads.indexOf(i) >= 0, line = [];
      for (var j = 0; j < width; j++) line.push(h ? '#EEF3F8' : null);
      bg.push(line); fw.push([h ? 'bold' : 'normal']); fc.push([h ? '#2F5D8A' : null]);
    }
    subsSh.getRange(2, 1, bg.length, width).setBackgrounds(bg);
    subsSh.getRange(2, S.paper, fw.length, 1).setFontWeights(fw).setFontColors(fc);

    // phones drop their old copy on the next sync; emails from before now no longer change anything
    var props = PropertiesService.getScriptProperties();
    props.setProperty('DATA_EPOCH', String(now.getTime()));
    props.setProperty('DATA_REPLACED_AT', now.toISOString());
    var el = ss.getSheetByName(EMAILS_SHEET);
    if (el && el.getLastRow() > 1) {
      var rg = el.getRange(2, 1, el.getLastRow() - 1, EMAIL_HEAD.length), v = rg.getValues();
      v.forEach(function (r) { if (str(r[9]) === 'Needs confirmation') r[9] = 'Not applied: data replaced from Sheet 2'; });
      rg.setValues(v);
    }
  } finally {
    lock.releaseLock();
  }
  handle({}); // suggested next journals for the new papers
  return { papers: d.papers.length, subs: list.length };
}

/** Puts the per-row formulas (ABDC, Days, helpers) on every row, taken from the first row that has them. */
function fillFormulas(sh, C, dataFields, rows) {
  var mine = {}; dataFields.forEach(function (f) { if (C[f]) mine[C[f]] = 1; });
  var ncol = sh.getLastColumn(), r1 = sh.getRange(2, 1, rows, ncol).getFormulasR1C1();
  for (var j = 0; j < ncol; j++) {
    if (mine[j + 1]) continue;
    var t = ''; for (var i = 0; i < r1.length && !t; i++) t = r1[i][j];
    if (!t) continue;
    var col = []; for (var k = 0; k < rows; k++) col.push([t]);
    sh.getRange(2, j + 1, rows, 1).setFormulasR1C1(col);
  }
}

/** Records an edit time (and an ID) on rows you change by hand, so the newest edit wins when syncing. */
function onEdit(e) {
  var sh = e.range.getSheet(), name = sh.getName();
  if (name !== 'Papers' && name !== 'Submissions') return;
  var C = cols(sh, name === 'Papers' ? PAPER_COLS : SUB_COLS);
  if (!C.id || !C.updated || e.range.getRow() < 2 || e.range.getColumn() === C.id || e.range.getColumn() === C.updated) return;
  for (var r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
    var named = sh.getRange(r, C[name === 'Papers' ? 'key' : 'journal']).getValue();
    if (!named) continue;
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
    var P = cols(ps, PAPER_COLS, ADD_PAPER), S = cols(subs, SUB_COLS, ADD_SUB);
    if (!P.key || !S.paper || !S.journal || !S.status) return { ok: false, error: 'Missing Paper / Journal / Status columns.' };
    var pb = block(ps, P), sb = block(subs, S), epoch = dataEpoch();
    if (epoch && String(body.epoch || '') !== epoch && !body.overwrite) { // the phone holds data from before a replace: take nothing from it
      body.papers = []; body.subs = []; body.deleted = []; body.emailDecisions = null; body.link = false;
    }
    var g = function (row, C, f) { return C[f] ? row[C[f] - 1] : ''; };
    var put = function (row, C, f, v) { if (C[f]) row[C[f] - 1] = v; };
    var isSub = function (row) { return !!str(g(row, S, 'journal')); };
    var subMatch = function (s) {
      return function (row) {
        return isSub(row) && str(g(row, S, 'paper')) === s.paper && norm(g(row, S, 'journal')) === norm(s.journal) &&
          (day(g(row, S, 'submitted'), tz) === (s.submitted || '') ||
           (str(g(row, S, 'status')) === 'Planned' && s.status === 'Planned'));
      };
    };

    // 1a. First connection keeping the sheet's data: attach the phone's IDs to matching rows (and its manuscript IDs /
    //     journal statuses where the sheet has none); nothing else changes.
    if (body.link) {
      (body.papers || []).forEach(function (p) {
        var i = find(pb, P, '', function (row) { return str(g(row, P, 'key')) === p.key; });
        if (i >= 0) put(pb.v[i], P, 'id', p.id);
      });
      (body.subs || []).forEach(function (s) {
        var i = find(sb, S, '', subMatch(s));
        if (i < 0) return;
        var row = sb.v[i];
        put(row, S, 'id', s.id);
        if (!str(g(row, S, 'msid')) && s.msid) put(row, S, 'msid', s.msid);
        if (!str(g(row, S, 'live')) && s.live) { put(row, S, 'live', s.live); put(row, S, 'liveAt', date(s.liveAt)); }
      });
      body.papers = []; body.subs = []; body.deleted = [];
    }

    // 1b. Apply the phone's changes (newest edit wins; "overwrite" = the phone's copy wins everywhere).
    (body.papers || []).forEach(function (p) {
      var i = find(pb, P, p.id, function (row) { return str(g(row, P, 'key')) === p.key || (p.oldKey && str(g(row, P, 'key')) === p.oldKey); });
      if (i < 0) i = freeRow(pb, function (row) { return !str(g(row, P, 'key')); }, -1);
      else if (!body.overwrite && updated(pb.v[i], P) > (p.mod || 0)) return;
      var row = pb.v[i], old = str(g(row, P, 'key'));
      put(row, P, 'key', p.key); put(row, P, 'title', p.title || ''); put(row, P, 'authors', p.authors || '');
      put(row, P, 'type', p.type || ''); put(row, P, 'override', p.override || ''); put(row, P, 'notes', p.notes || '');
      if (p.approach !== undefined) put(row, P, 'approach', p.approach || '');
      put(row, P, 'id', p.id); put(row, P, 'updated', new Date(p.mod || Date.now()));
      if (old && old !== p.key) sb.v.forEach(function (r) { if (str(g(r, S, 'paper')) === old) put(r, S, 'paper', p.key); });
    });
    (body.subs || []).forEach(function (s) {
      var i = find(sb, S, s.id, subMatch(s));
      if (i < 0) i = freeRow(sb, function (row) { return !str(g(row, S, 'paper')) && !str(g(row, S, 'journal')); },
                             lastIndexOf(sb, function (row) { return str(g(row, S, 'paper')) === s.paper; }));
      else if (!body.overwrite && updated(sb.v[i], S) > (s.mod || 0)) return;
      var row = sb.v[i];
      put(row, S, 'paper', s.paper); put(row, S, 'journal', s.journal); put(row, S, 'rating', s.rating || '');
      put(row, S, 'status', s.status || ''); put(row, S, 'submitted', date(s.submitted)); put(row, S, 'decided', date(s.decided));
      put(row, S, 'notes', s.notes || ''); put(row, S, 'titleUsed', s.titleUsed || ''); put(row, S, 'msid', s.msid || '');
      put(row, S, 'live', s.live || ''); put(row, S, 'liveAt', date(s.liveAt)); put(row, S, 'dtype', s.dtype || '');
      put(row, S, 'id', s.id); put(row, S, 'updated', new Date(s.mod || Date.now()));
    });
    if (body.emailDecisions) applyEmailDecisions(body.emailDecisions, sb, S, ss);
    (body.deleted || []).forEach(function (id) {
      var i = find(pb, P, id, null);
      if (i >= 0) ['key', 'title', 'authors', 'type', 'override', 'notes', 'suggest', 'id', 'updated', 'approach'].forEach(function (f) { put(pb.v[i], P, f, ''); });
      i = find(sb, S, id, null);
      if (i >= 0) ['paper', 'journal', 'rating', 'status', 'submitted', 'decided', 'notes', 'titleUsed', 'msid', 'live', 'liveAt', 'dtype', 'id', 'updated']
        .forEach(function (f) { put(sb.v[i], S, f, ''); });
    });

    // 2. IDs for every paper and submission.
    pb.v.forEach(function (r) { if (str(g(r, P, 'key')) && !str(g(r, P, 'id'))) put(r, P, 'id', Utilities.getUuid()); });
    sb.v.forEach(function (r) { if (isSub(r) && !str(g(r, S, 'id'))) put(r, S, 'id', Utilities.getUuid()); });

    // 3. Suggested next journals (same method as the app), from the ABDC list tab.
    var abdc = abdcList(ss);
    if (abdc.length && P.suggest) {
      pb.v.forEach(function (r) {
        var key = str(g(r, P, 'key'));
        if (!key) return;
        if (str(g(r, P, 'override'))) { put(r, P, 'suggest', ''); return; }
        var mine = sb.v.filter(function (x) { return isSub(x) && str(g(x, S, 'paper')) === key; }).map(function (x) {
          return { journal: str(g(x, S, 'journal')), status: str(g(x, S, 'status')), submitted: day(g(x, S, 'submitted'), tz) };
        });
        var list = rdSuggest({ key: key, title: str(g(r, P, 'title')) }, mine, abdc, 5);
        put(r, P, 'suggest', list.map(function (j) { return j.title + ' (' + j.grade + ')'; }).join(' · '));
      });
    }
    save(ps, pb); save(subs, sb);

    // 4. Per-journal data (Journals tab) and app settings; emails waiting for confirmation in the app.
    var app = appData(ss, body.app);
    var pending = emailQueue(ss, body.resolved || []);
    var insights = insightRows(ss, body.savedInsights || []);
    if (body.aiLog && body.aiLog.length) aiLogAdd(ss, body.aiLog);
    var ai = aiRows(ss);

    // 5. Send everything back.
    return {
      ok: true, now: Date.now(), epoch: epoch, sheet: ss.getName(), app: app, ai: ai, pending: pending, insights: insights,
      papers: pb.v.filter(function (r) { return str(g(r, P, 'key')); }).map(function (r) {
        return { id: str(g(r, P, 'id')), key: str(g(r, P, 'key')), title: str(g(r, P, 'title')), authors: str(g(r, P, 'authors')),
                 type: str(g(r, P, 'type')), override: str(g(r, P, 'override')), notes: str(g(r, P, 'notes')), approach: str(g(r, P, 'approach')) };
      }),
      subs: sb.v.filter(isSub).map(function (r) {
        return { id: str(g(r, S, 'id')), paper: str(g(r, S, 'paper')), journal: str(g(r, S, 'journal')), rating: str(g(r, S, 'rating')),
                 abdc: str(g(r, S, 'abdc')), status: str(g(r, S, 'status')), submitted: day(g(r, S, 'submitted'), tz),
                 decided: day(g(r, S, 'decided'), tz), notes: str(g(r, S, 'notes')), titleUsed: str(g(r, S, 'titleUsed')),
                 msid: str(g(r, S, 'msid')), live: str(g(r, S, 'live')), liveAt: day(g(r, S, 'liveAt'), tz), dtype: str(g(r, S, 'dtype')) };
      })
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------
/** Column numbers by header name; adds missing app columns (with their header) at the right when `add` is given. */
function cols(sh, spec, add) {
  var last = Math.max(sh.getLastColumn(), 1), heads = sh.getRange(1, 1, 1, last).getValues()[0], C = {}, taken = {};
  Object.keys(spec).forEach(function (f) {
    for (var c = 0; c < heads.length; c++) {
      var h = str(heads[c]);
      if (!taken[c] && h && spec[f].test(h) && !(f === 'rating' && /abdc/i.test(h))) { C[f] = c + 1; taken[c] = 1; break; }
    }
  });
  Object.keys(add || {}).forEach(function (f) {
    if (!C[f]) { last++; sh.getRange(1, last).setValue(add[f]).setFontWeight('bold'); C[f] = last; }
  });
  return C;
}

/** Reads the whole sheet once: values plus formulas (so writing back keeps the formulas). */
function block(sh, C) {
  var maxC = 1; Object.keys(C).forEach(function (f) { maxC = Math.max(maxC, C[f]); });
  var rows = Math.max(sh.getLastRow() - 1, 1), ncol = Math.max(sh.getLastColumn(), maxC);
  var rg = sh.getRange(2, 1, rows, ncol);
  return { v: rg.getValues(), f: rg.getFormulas(), cols: ncol, added: 0, used: {} };
}

function save(sh, b) {
  var data = b.v.map(function (r, i) { return r.map(function (x, j) { var f = b.f[i] && b.f[i][j]; return f ? f : x; }); });
  sh.getRange(2, 1, data.length, b.cols).setValues(data);
  if (b.added) { // new rows past the end: copy formulas down from row 2
    var first = 2 + data.length - b.added;
    for (var j = 0; j < b.cols; j++) for (var i = 0; i < first - 2; i++) if (b.f[i][j]) { sh.getRange(i + 2, j + 1).copyTo(sh.getRange(first, j + 1, b.added, 1)); break; }
  }
}

function find(b, C, id, natural) {
  if (id) for (var i = 0; i < b.v.length; i++) if (str(b.v[i][C.id - 1]) === id) return i;
  if (natural) for (var k = 0; k < b.v.length; k++) if (!str(b.v[k][C.id - 1]) && natural(b.v[k])) return k;
  return -1;
}

function lastIndexOf(b, pred) { for (var i = b.v.length - 1; i >= 0; i--) if (pred(b.v[i])) return i; return -1; }

/** A free row: right under the paper's own rows when there is a spare one, else after the last used row. */
function freeRow(b, isFree, near) {
  if (near >= 0) for (var i = near + 1; i < b.v.length && isFree(b.v[i]); i++) if (!b.used[i]) { b.used[i] = 1; return i; }
  var lastUsed = lastIndexOf(b, function (r) { return !isFree(r); });
  for (var k = lastUsed + 1; k < b.v.length; k++) if (!b.used[k]) { b.used[k] = 1; return k; }
  var row = []; for (var j = 0; j < b.cols; j++) row.push('');
  b.v.push(row); b.f.push(row.map(function () { return ''; })); b.added++;
  b.used[b.v.length - 1] = 1;
  return b.v.length - 1;
}

function abdcList(ss) {
  var sh = ss.getSheetByName(ABDC_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return [str(r[0]), str(r[1]), +r[2] || 0, str(r[3])]; });
}

/** Journal login links / editorial emails live on the Journals tab (when present); chase days in a hidden tab. */
function appData(ss, incoming) {
  var sh = ss.getSheetByName(APP_SHEET);
  if (!sh) { sh = ss.insertSheet(APP_SHEET); sh.hideSheet(); sh.getRange(1, 1, 1, 2).setValues([['setting', 'value (JSON)']]); }
  var cur = {};
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues().slice(1).forEach(function (r) { try { cur[r[0]] = JSON.parse(r[1]); } catch (e) {} });
  var js = ss.getSheetByName('Journals'), J = js ? cols(js, JOURNAL_COLS) : null;
  if (incoming) {
    ['portals', 'contacts'].forEach(function (k) { if (incoming[k]) cur[k] = Object.assign({}, cur[k] || {}, incoming[k]); });
    if (incoming.chaseDays) cur.chaseDays = incoming.chaseDays;
    if (incoming.settings) cur.settings = Object.assign({}, cur.settings || {}, incoming.settings);
    if (J && J.journal) { // mirror links and emails onto the Journals tab
      var jb = block(js, J), at = {};
      jb.v.forEach(function (r, i) { if (str(r[J.journal - 1])) at[norm(r[J.journal - 1])] = i; });
      [['portals', 'link'], ['contacts', 'email']].forEach(function (x) {
        if (!J[x[1]]) return;
        Object.keys(incoming[x[0]] || {}).forEach(function (name) {
          var v = incoming[x[0]][name];
          if (!v) return;
          var i = at[norm(name)];
          if (i === undefined) { i = freeRow(jb, function (r) { return !str(r[J.journal - 1]); }, -1); jb.v[i][J.journal - 1] = name; at[norm(name)] = i; }
          if (str(jb.v[i][J[x[1]] - 1]) !== v) jb.v[i][J[x[1]] - 1] = v;
        });
      });
      save(js, jb);
    }
    var rows = [['setting', 'value (JSON)']];
    Object.keys(cur).forEach(function (k) { rows.push([k, JSON.stringify(cur[k])]); });
    sh.clearContents(); sh.getRange(1, 1, rows.length, 2).setValues(rows);
  }
  if (J && J.journal) {
    var vals = block(js, J).v;
    cur.portals = cur.portals || {}; cur.contacts = cur.contacts || {}; cur.abdc = {};
    vals.forEach(function (r) {
      var name = str(r[J.journal - 1]);
      if (!name) return;
      if (J.link && str(r[J.link - 1])) cur.portals[name] = str(r[J.link - 1]);
      if (J.email && str(r[J.email - 1])) cur.contacts[name] = str(r[J.email - 1]);
      if (J.abdc && str(r[J.abdc - 1])) cur.abdc[name] = str(r[J.abdc - 1]);
    });
  }
  return cur;
}

function str(x) { return x === null || x === undefined ? '' : String(x).trim(); }
function norm(x) { return str(x).toLowerCase().replace(/\s+/g, ' '); }
function updated(row, C) { var u = C.updated ? row[C.updated - 1] : 0; return u instanceof Date ? u.getTime() : (+u || 0); }
function day(x, tz) {
  if (x instanceof Date) return Utilities.formatDate(x, tz, 'yyyy-MM-dd');
  var s = str(x); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}
function date(s) { if (!s) return ''; var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

// ---------- journal emails from Gmail ----------
function turnOnEmailImport() {
  turnOffEmailImport(true);
  ScriptApp.newTrigger('processEmails').timeBased().everyMinutes(15).create();
  if (!GmailApp.getUserLabelByName(MAIL_LABEL)) GmailApp.createLabel(MAIL_LABEL);
  var r = importEmails(400);
  SpreadsheetApp.getActive().toast('Email import is on (every 15 minutes). First run: ' + r.summary, 'RD SK', 12);
}
function turnOffEmailImport(quiet) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'processEmails') ScriptApp.deleteTrigger(t); });
  if (quiet !== true) SpreadsheetApp.getActive().toast('Email import is off.', 'RD SK');
}
function importEmailsNow() { SpreadsheetApp.getActive().toast(importEmails(30).summary, 'RD SK', 10); }
function processEmails() { importEmails(3); }

function logSheet(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < head.length) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  return sh;
}

/** Reads recent journal emails and applies them. `days` = how far back to look. */
function importEmails(days) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var counts = { updated: 0, confirm: 0, already: 0 };
  try {
    var ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), me = Session.getEffectiveUser().getEmail();
    var ps = ss.getSheetByName('Papers'), subsSh = ss.getSheetByName('Submissions');
    var P = cols(ps, PAPER_COLS, ADD_PAPER), S = cols(subsSh, SUB_COLS, ADD_SUB);
    var pb = block(ps, P), sb = block(subsSh, S);
    var el = logSheet(ss, EMAILS_SHEET, EMAIL_HEAD), dl = logSheet(ss, DECISIONS_SHEET, DECISION_HEAD);
    var seen = {};
    if (el.getLastRow() > 1) el.getRange(2, 12, el.getLastRow() - 1, 1).getValues().forEach(function (r) { seen[str(r[0])] = 1; });
    var plus = me.replace('@', '+rdsk@');
    var cutoff = emailFromDate(), replaced = dataReplacedAt();
    var q = '(label:' + MAIL_LABEL + ' OR to:' + plus + ' OR from:(' + JOURNAL_SENDERS.join(' OR ') + ')) newer_than:' + days + 'd' +
      ' after:' + cutoff.replace(/-/g, '/');
    var msgs = [];
    GmailApp.search(q, 0, 300).forEach(function (t) { t.getMessages().forEach(function (m) { if (!seen[m.getId()]) msgs.push(m); }); });
    msgs.sort(function (a, b) { return a.getDate() - b.getDate(); }); // oldest first, so history applies in order
    var titles = {};
    pb.v.forEach(function (r) { titles[str(r[P.key - 1])] = P.title ? str(r[P.title - 1]) : ''; });
    var logRows = [], decRows = [];
    msgs.forEach(function (m) {
      var body = m.getPlainBody() || '', subject = m.getSubject() || '', from = m.getFrom() || '';
      var fwd = body.match(/^\s*Date:\s*(.+)$/m), when = m.getDate();
      if (/forwarded message|^fwd?:/i.test(body.slice(0, 400) + '\n' + subject) && fwd && !isNaN(Date.parse(fwd[1]))) when = new Date(Date.parse(fwd[1]));
      var whenDay = Utilities.formatDate(when, tz, 'yyyy-MM-dd');
      if (whenDay < cutoff) return;                                   // older emails are left alone
      if (replaced && when < replaced) return;                        // so are emails from before the data was replaced
      var cand = [];
      sb.v.forEach(function (r) {
        if (!str(r[S.journal - 1])) return;
        var paper = str(r[S.paper - 1]);
        cand.push({ id: str(r[S.id - 1]), paper: paper, title: titles[paper] || '', titleUsed: S.titleUsed ? str(r[S.titleUsed - 1]) : '',
                    journal: str(r[S.journal - 1]), status: str(r[S.status - 1]), submitted: day(r[S.submitted - 1], tz),
                    msid: S.msid ? str(r[S.msid - 1]) : '', row: r });
      });
      var res = rdParseEmail({ subject: subject, from: from, body: body, date: whenDay }, cand);
      if (!res.event || res.skip) return;                             // not about one of your manuscripts
      var looksJournal = res.msid || /manuscript|submission|decision|your paper/i.test(subject);
      if (!res.sub && !looksJournal) return;
      var link = 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + '#all/' + m.getThread().getId();
      var action, undoData = '';
      if (res.sub && res.confident) {
        var applied = applyEmail(res, res.sub.row, S, sb, whenDay, m.getId());
        action = applied.action; undoData = applied.undo ? JSON.stringify(applied.undo) : '';
        if (/^Updated/.test(action)) counts.updated++; else counts.already++;
      } else { action = 'Needs confirmation'; counts.confirm++; }
      var sub = res.sub || {};
      logRows.push([when, from, subject, sub.paper || '', sub.journal || '', res.status || res.event, res.dtype, res.reviews || '', res.msid,
                    action, link, m.getId(), undoData]);
      if (/Rejected|Revision requested|Accepted|Returned by office/.test(res.event))
        decRows.push([when, sub.paper || '', sub.journal || '', res.event, res.dtype, res.reviews || '', res.msid,
                      body.replace(/\r/g, '').slice(0, 45000), link, m.getId()]);
      if (!res.sub || !res.confident) {
        var label = GmailApp.getUserLabelByName(MAIL_LABEL) || GmailApp.createLabel(MAIL_LABEL);
        m.getThread().addLabel(label);
      }
    });
    save(subsSh, sb);
    if (logRows.length) el.getRange(el.getLastRow() + 1, 1, logRows.length, EMAIL_HEAD.length).setValues(logRows);
    if (decRows.length) dl.getRange(dl.getLastRow() + 1, 1, decRows.length, DECISION_HEAD.length).setValues(decRows);
  } finally {
    lock.releaseLock();
  }
  if (counts.updated) handle({}); // refresh IDs and suggested journals
  return { counts: counts, summary: counts.updated + ' updated, ' + counts.already + ' already up to date, ' + counts.confirm + ' to confirm in the app' };
}

/**
 * Applies one confidently matched email to its Submissions row (never moves a row backwards).
 * Returns {action, undo}: undo holds the row's App ID and the values before the change (or the ID of a row it added),
 * so "RD SK → Repair" can put everything back exactly.
 */
function applyEmail(res, row, S, sb, whenDay, msgId) {
  var cur = str(row[S.status - 1]), was = cur, changed = [], before = {};
  // a submission already decided before the start date keeps its status and details as they are
  var settledOn = day(row[S.decided - 1], 'UTC') || (RD_ORDER[cur] >= 2 ? day(row[S.submitted - 1], 'UTC') : '');
  if (settledOn && settledOn < emailFromDate()) return { action: 'Left as is (decided before ' + emailFromDate() + ')', undo: null };
  var keep = function (f) { if (S[f] && !(f in before)) { var v = row[S[f] - 1]; before[f] = v instanceof Date ? 'd:' + day(v, 'UTC') : str(v); } };
  var set = function (f, v) { if (S[f] && str(row[S[f] - 1]) !== str(v)) { keep(f); row[S[f] - 1] = v; changed.push(f); } };
  if (!str(row[S.id - 1])) row[S.id - 1] = Utilities.getUuid();
  var rowId = str(row[S.id - 1]);
  if (res.msid && S.msid && !str(row[S.msid - 1])) set('msid', res.msid);
  var decidedDay = day(row[S.decided - 1], 'UTC'), submittedDay = day(row[S.submitted - 1], 'UTC');
  var newRow = function (status) {
    var near = -1; sb.v.forEach(function (r, i) { if (str(r[S.paper - 1]) === str(row[S.paper - 1])) near = i; });
    var i = freeRow(sb, function (r) { return !str(r[S.paper - 1]) && !str(r[S.journal - 1]); }, near), r = sb.v[i], id = Utilities.getUuid();
    r[S.paper - 1] = row[S.paper - 1]; r[S.journal - 1] = row[S.journal - 1]; r[S.status - 1] = status; r[S.submitted - 1] = date(whenDay);
    if (S.msid) r[S.msid - 1] = res.msid || ''; if (S.notes) r[S.notes - 1] = 'From email';
    r[S.id - 1] = id; r[S.updated - 1] = new Date();
    if (changed.length) row[S.updated - 1] = new Date();
    return { action: 'Updated: new ' + status + ' row', undo: { id: rowId, before: before, created: id } };
  };
  // a genuine new submission to the same journal: dated after that journal's decision, with a different manuscript ID
  var resubmission = decidedDay && whenDay > decidedDay && (!res.msid || !str(row[S.msid - 1]) || rdBaseId(res.msid) !== rdBaseId(row[S.msid - 1]));
  var ev = res.event, order = RD_ORDER;
  if (ev === 'submitted') {
    if (cur === 'Planned') { set('status', 'Under review'); set('submitted', date(whenDay)); }
    else if (order[cur] >= 2 && resubmission) return newRow('Under review');
  } else if (ev === 'resubmitted') {
    if (cur === 'Revision requested' && (!submittedDay || whenDay > submittedDay)) {
      set('status', 'Revision resubmitted'); if (!decidedDay) set('decided', date(whenDay)); return newRow('Under review');
    }
    if ((cur === 'Returned by office' || order[cur] >= 4) && resubmission) return newRow('Under review');
  } else if (ev === 'under review') {
    if (cur === 'Planned') { set('status', 'Under review'); set('submitted', date(whenDay)); }
    if (S.live && (cur === 'Under review' || cur === 'Planned')) { set('live', 'Sent for review'); set('liveAt', date(whenDay)); }
  } else if (order[ev] !== undefined && (!submittedDay || whenDay >= submittedDay)) {
    if (cur === ev) { if (S.decided && !decidedDay) set('decided', date(whenDay)); }
    else if (order[ev] > order[cur]) { set('status', ev); set('decided', date(whenDay)); }
    if (res.dtype && str(row[S.status - 1]) === 'Rejected') set('dtype', res.dtype + (res.reviews > 1 ? ' (' + res.reviews + ' reviews)' : ''));
  }
  if (!changed.length) return { action: 'Already up to date', undo: null };
  row[S.updated - 1] = new Date();
  return { action: 'Updated: ' + (str(row[S.status - 1]) !== was ? was + ' → ' + str(row[S.status - 1]) : changed.join(', ')),
           undo: { id: rowId, before: before } };
}

/** Puts back every change the email import made (exactly, from the Undo data; older entries by their description),
 *  clears the email log except the emails you confirmed or dismissed in the app, and reads the emails again. */
function repairEmailImport() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Repair email import', 'This undoes every change the email import made to Submissions, then reads your journal ' +
      'emails again with the stricter rules (anything unclear will wait for you in the app). Emails you already confirmed ' +
      'or dismissed in the app are kept. Continue?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var r = undoEmailChanges();
  var again = importEmails(400);
  ui.alert('Repair finished', r.undone + ' change(s) undone' + (r.unsure ? ', ' + r.unsure + ' could not be matched (listed on the Emails tab)' : '') +
    '.\n\nRe-read: ' + again.summary + '.\n\nNow open RD SK and tap More → Google Sheets sync → Sync now.', ui.ButtonSet.OK);
}

function undoEmailChanges() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var undone = 0, unsure = [], keepRows = [];
  try {
    var ss = SpreadsheetApp.getActive(), subsSh = ss.getSheetByName('Submissions'), S = cols(subsSh, SUB_COLS, ADD_SUB), sb = block(subsSh, S);
    var el = logSheet(ss, EMAILS_SHEET, EMAIL_HEAD);
    var log = el.getLastRow() > 1 ? el.getRange(2, 1, el.getLastRow() - 1, EMAIL_HEAD.length).getValues() : [];
    var byId = {}; sb.v.forEach(function (r, i) { if (str(r[S.id - 1])) byId[str(r[S.id - 1])] = i; });
    var touch = function (r) { r[S.updated - 1] = new Date(); undone++; };
    var clearRow = function (r) { ['paper', 'journal', 'rating', 'status', 'submitted', 'decided', 'notes', 'titleUsed', 'msid', 'live', 'liveAt', 'dtype', 'id']
      .forEach(function (f) { if (S[f]) r[S[f] - 1] = ''; }); r[S.updated - 1] = ''; undone++; };
    var dayOf = function (v) { return day(v, 'UTC'); };
    var near = function (a, b) { return a && b && Math.abs((Date.parse(a) - Date.parse(b)) / 864e5) <= 1; };
    // newest first, so later changes are undone before earlier ones
    var replaced = dataReplacedAt();
    log.slice().reverse().forEach(function (e) {
      var action = str(e[9]);
      if (replaced && e[0] instanceof Date && e[0] < replaced) { keepRows.push(e); return; } // before the data was replaced
      if (/^(Confirmed|Dismissed) in the app/.test(action)) { keepRows.push(e); return; }
      if (!/^Updated/.test(action)) return;
      var undo = null; try { undo = str(e[12]) ? JSON.parse(str(e[12])) : null; } catch (x) {}
      if (undo) {
        if (undo.created && byId[undo.created] !== undefined) clearRow(sb.v[byId[undo.created]]);
        var i = byId[undo.id];
        if (i !== undefined && undo.before) {
          Object.keys(undo.before).forEach(function (f) { var v = undo.before[f]; sb.v[i][S[f] - 1] = /^d:/.test(v) ? date(v.slice(2)) : v; });
          if (Object.keys(undo.before).length) touch(sb.v[i]);
        }
        return;
      }
      // entries written before Undo data existed: undo from the description
      var paper = str(e[3]), journal = str(e[4]), when = dayOf(e[0]) || str(e[0]).slice(0, 10), msid = str(e[8]);
      var rows = sb.v.filter(function (r) { return str(r[S.paper - 1]) === paper && str(r[S.journal - 1]) === journal; });
      var m = action.match(/^Updated: (.+?) → (.+)$/), done = false;
      if (/^Updated: new /.test(action)) {
        rows.filter(function (r) { return str(r[S.notes - 1]) === 'From email' && near(dayOf(r[S.submitted - 1]), when); }).slice(0, 1)
          .forEach(function (r) { clearRow(r); done = true; });
        rows.filter(function (r) { return str(r[S.status - 1]) === 'Revision resubmitted' && near(dayOf(r[S.decided - 1]), when); }).slice(0, 1)
          .forEach(function (r) { r[S.status - 1] = 'Revision requested'; r[S.decided - 1] = ''; touch(r); });
      } else if (m) {
        var from = m[1], to = m[2];
        var hit = rows.filter(function (r) { return str(r[S.status - 1]) === to && (to === 'Under review' ? near(dayOf(r[S.submitted - 1]), when) : near(dayOf(r[S.decided - 1]), when)); });
        if (!hit.length) hit = rows.filter(function (r) { return str(r[S.status - 1]) === to; }).slice(0, rows.filter(function (r) { return str(r[S.status - 1]) === to; }).length === 1 ? 1 : 0);
        hit.slice(0, 1).forEach(function (r) {
          r[S.status - 1] = from;
          if (from === 'Planned' || from === 'Under review') { r[S.decided - 1] = ''; if (S.dtype) r[S.dtype - 1] = ''; }
          if (from === 'Planned') r[S.submitted - 1] = '';
          if (S.msid && msid && str(r[S.msid - 1]) === msid) r[S.msid - 1] = '';
          if (S.live && str(r[S.live - 1]) === 'Sent for review') { r[S.live - 1] = ''; r[S.liveAt - 1] = ''; }
          touch(r); done = true;
        });
      } else { // field-only update: take back what the email put in
        rows.forEach(function (r) {
          if (S.msid && msid && str(r[S.msid - 1]) === msid) { r[S.msid - 1] = ''; done = true; }
          if (S.dtype && str(e[6]) && str(r[S.dtype - 1]).indexOf(str(e[6])) === 0) { r[S.dtype - 1] = ''; done = true; }
          if (S.live && str(r[S.live - 1]) === 'Sent for review' && near(dayOf(r[S.liveAt - 1]), when)) { r[S.live - 1] = ''; r[S.liveAt - 1] = ''; done = true; }
          if (done) touch(r);
        });
      }
      if (!done) unsure.push(e);
    });
    save(subsSh, sb);
    // keep only the emails you decided on in the app (and list the ones that couldn't be undone), then re-read the rest
    var rest = keepRows.concat(unsure.map(function (e) { var c = e.slice(); c[9] = 'Could not undo: please check this row'; return c; }));
    el.getRange(2, 1, Math.max(el.getLastRow() - 1, 1), EMAIL_HEAD.length).clearContent();
    if (rest.length) el.getRange(2, 1, rest.length, EMAIL_HEAD.length).setValues(rest);
    var dl = ss.getSheetByName(DECISIONS_SHEET);
    if (dl && dl.getLastRow() > 1) dl.getRange(2, 1, dl.getLastRow() - 1, DECISION_HEAD.length).clearContent();
  } finally {
    lock.releaseLock();
  }
  return { undone: undone, unsure: unsure.length };
}

/** Emails waiting for the app; `resolved` = [{id, action}] from the app marks them done. */
function emailQueue(ss, resolved) {
  var sh = ss.getSheetByName(EMAILS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var rg = sh.getRange(2, 1, sh.getLastRow() - 1, EMAIL_HEAD.length), v = rg.getValues(), done = {}, out = [], dirty = false;
  resolved.forEach(function (x) { done[x.id] = x.action || 'Confirmed in the app'; });
  v.forEach(function (r) {
    var id = str(r[11]);
    if (str(r[9]) !== 'Needs confirmation') return;
    if (done[id]) { r[9] = done[id]; dirty = true; return; }
    out.push({ id: id, date: r[0] instanceof Date ? r[0].toISOString().slice(0, 10) : str(r[0]), from: str(r[1]), subject: str(r[2]),
               paper: str(r[3]), journal: str(r[4]), guess: str(r[5]), dtype: str(r[6]), reviews: +r[7] || 0, msid: str(r[8]), link: str(r[10]) });
  });
  if (dirty) rg.setValues(v);
  if (out.length) { // add the email text for the app to show
    var texts = {};
    out.forEach(function (x) { try { var m = GmailApp.getMessageById(x.id); texts[x.id] = (m.getPlainBody() || '').slice(0, 4000); } catch (e) {} });
    out.forEach(function (x) { x.body = texts[x.id] || ''; });
  }
  return out;
}

/** Decision type / reviews chosen in the app for an email are written to the Decisions & reviews tab. */
function applyEmailDecisions(list, sb, S, ss) {
  var dl = ss.getSheetByName(DECISIONS_SHEET);
  if (!dl || dl.getLastRow() < 2) return;
  var rg = dl.getRange(2, 1, dl.getLastRow() - 1, DECISION_HEAD.length), v = rg.getValues();
  list.forEach(function (x) { v.forEach(function (r) { if (str(r[9]) === x.id) { r[1] = x.paper || r[1]; r[2] = x.journal || r[2]; r[3] = x.status || r[3]; r[4] = x.dtype || r[4]; } }); });
  rg.setValues(v);
}

// ---------- Ask AI (the app's AI tab): answers with your Gemini key (free) or Claude key, logged on the 'AI chat' tab ----------
var AI_SHEET = 'AI chat';
var AI_HEAD = ['Date', 'Paper', 'Approach', 'Question', 'Journal', 'Details', 'Answer', 'By', 'ID'];

/** One question from the app: {id, prompt, paper, approach, kind, journal, question}. The prompt is built on the phone. */
function aiAsk(a) {
  var props = PropertiesService.getScriptProperties(), gKey = props.getProperty('GEMINI_API_KEY'), cKey = props.getProperty('CLAUDE_API_KEY');
  if (!gKey && !cKey) return { ok: false, error: "No AI key in the sheet yet. In the Google Sheet: RD SK menu → Set free Gemini API key." };
  var prompt = String(a.prompt || '').slice(0, 60000), r = null, err = '';
  if (gKey) { r = geminiText(gKey, prompt); if (r.error) { err = r.error; r = null; } }
  if (!r && cKey) { r = claudeText(cKey, prompt); if (r.error) { err = err || r.error; r = null; } }
  if (!r) return { ok: false, error: err || 'No answer' };
  var entry = { id: a.id || Utilities.getUuid(), at: new Date().toISOString(), paper: a.paper || '', approach: a.approach || '', kind: a.kind || '',
                journal: a.journal || '', question: a.question || '', answer: r.text, by: r.by, sources: r.sources || [] };
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { aiLogAdd(SpreadsheetApp.getActive(), [entry]); } finally { lock.releaseLock(); }
  return { ok: true, entry: entry };
}

/**
 * Gemini text answer: Google Search grounding first (fresher journal facts), then plain. A busy model (500/503/504) is
 * retried once and then the next free model is tried; a model out of free quota (429) is skipped. {text, by, sources} or {error}.
 */
function geminiText(key, prompt) {
  var models = geminiModels(key).slice(0, 4), started = Date.now(), busy = 0, quota = 0, last = '';
  var call = function (model, grounded) {
    var body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } };
    if (grounded) body.tools = [{ google_search: {} }];
    return UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body) });
  };
  for (var m = 0; m < models.length; m++) {
    var plan = [true, false, false]; // grounded, plain, plain again after a pause if the model was busy
    for (var k = 0; k < plan.length; k++) {
      if (Date.now() - started > 85000) return { error: geminiErr(busy, quota, last) };
      if (k === 2 && !busy) break;
      try {
        var r = call(models[m], plan[k]), code = r.getResponseCode();
        if (code === 429) { quota++; break; }                                  // this model's free quota is used up
        if (code === 500 || code === 503 || code === 504) { busy++; Utilities.sleep(k === 1 ? 2500 : 800); continue; }
        if (code === 404) break;                                               // model not available to this key
        if (code !== 200) { last = 'Gemini error ' + code; continue; }
        var res = JSON.parse(r.getContentText()), c = (res.candidates || [])[0];
        var text = c && c.content ? (c.content.parts || []).map(function (p) { return p.text || ''; }).join('').trim() : '';
        if (!text) { last = 'Gemini gave no answer' + (c && c.finishReason ? ' (' + c.finishReason + ')' : ''); continue; }
        var src = ((c.groundingMetadata || {}).groundingChunks || []).map(function (g) { return g.web ? { title: g.web.title || '', url: g.web.uri } : null; })
          .filter(function (x) { return x && x.url; }).slice(0, 8);
        return { text: text, by: 'Gemini (' + models[m] + (plan[k] ? ', with Google Search' : '') + ')', sources: src };
      } catch (e) { last = String(e && e.message || e); }
    }
  }
  return { error: geminiErr(busy, quota, last) };
}
function geminiErr(busy, quota, last) {
  if (busy) return "Google's free Gemini models are busy right now (error 503), even after retrying. Try again in a few minutes, or use “Ask in Gemini app”.";
  if (quota) return "Gemini's free limit is used up for now. Try again later (it resets daily), or use “Ask in Gemini app”.";
  return last || 'Gemini gave no answer';
}

function claudeText(key, prompt) {
  try {
    var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      payload: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 8000, fallbacks: 'default', output_config: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }] }) });
    if (r.getResponseCode() !== 200) return { error: 'Claude error ' + r.getResponseCode() };
    var msg = JSON.parse(r.getContentText());
    if (msg.stop_reason === 'refusal') return { error: 'Claude declined to answer' };
    var text = (msg.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
    return text ? { text: text, by: 'Claude', sources: [] } : { error: 'Claude gave no answer' };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

/** Adds answers to the 'AI chat' tab (skips IDs already there). */
function aiLogAdd(ss, list) {
  var sh = logSheet(ss, AI_SHEET, AI_HEAD), have = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 9, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { have[str(r[0])] = 1; });
  var rows = list.filter(function (e) { return e && e.id && e.answer && !have[e.id]; }).map(function (e) {
    var src = (e.sources || []).map(function (x) { return '\n- ' + (x.title || 'source') + ': ' + x.url; }).join('');
    return [new Date(e.at || Date.now()), e.paper || '', e.approach || '', e.kind || '', e.journal || '', e.question || '',
            String(e.answer).slice(0, 45000) + (src ? '\n\nSources:' + src : ''), e.by || '', e.id];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, AI_HEAD.length).setValues(rows);
}

/** The latest 100 answers, so a reinstalled app gets them back. */
function aiRows(ss) {
  var sh = ss.getSheetByName(AI_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(sh.getLastRow() - 1, 100);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, AI_HEAD.length).getValues().filter(function (r) { return str(r[8]) && str(r[6]); }).map(function (r) {
    return { id: str(r[8]), at: r[0] instanceof Date ? r[0].toISOString() : str(r[0]), paper: str(r[1]), approach: str(r[2]), kind: str(r[3]),
             journal: str(r[4]), question: str(r[5]), answer: str(r[6]), by: str(r[7]) };
  });
}

// ---------- daily research insights (Crossref + the watch list; optional Claude-written ideas) ----------
var INSIGHTS_SHEET = 'Research insights';
var INSIGHT_HEAD = ['Date', '#', 'Title', 'Authors', 'Journal', 'ABDC', 'FT50', 'Published', 'DOI', 'Related paper', 'Why relevant',
  'Next-study idea', 'Abstract', 'Idea by', 'Saved'];

function turnOnDailyInsights() {
  turnOffDailyInsights(true);
  ScriptApp.newTrigger('dailyInsights').timeBased().everyDays(1).atHour(7).create();
  var r = runInsights();
  SpreadsheetApp.getActive().toast('Daily insights are on (about 7 am). ' + r.summary, 'RD SK', 12);
}
function turnOffDailyInsights(quiet) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyInsights') ScriptApp.deleteTrigger(t); });
  if (quiet !== true) SpreadsheetApp.getActive().toast('Daily insights are off.', 'RD SK');
}
function insightsNow() { SpreadsheetApp.getActive().toast(runInsights().summary, 'RD SK', 12); }
function dailyInsights() { runInsights(); }

function setClaudeKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Claude API key (optional)', 'Paste a key from console.anthropic.com (starts with sk-ant-). It is stored in this ' +
    "script's private properties and used once a day to write the next-study ideas. Leave empty to remove it.", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim(), props = PropertiesService.getScriptProperties();
  if (key) props.setProperty('CLAUDE_API_KEY', key); else props.deleteProperty('CLAUDE_API_KEY');
  ui.alert(key ? 'Saved. Tomorrow\'s insights (or "Get today\'s research insights now") will use Claude-written ideas.' : 'Key removed.');
}

function setGeminiKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Free Gemini API key', 'Get a free key at aistudio.google.com → Get API key (no card needed). On the free tier ' +
    'Google may use what is sent (paper titles and abstracts) to improve its products. The key is stored in this script\'s ' +
    'private properties. Leave empty to remove it.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim(), props = PropertiesService.getScriptProperties();
  if (key) props.setProperty('GEMINI_API_KEY', key); else props.deleteProperty('GEMINI_API_KEY');
  ui.alert(key ? 'Saved. Insights will now use Gemini-written ideas (free). Run "Get today\'s research insights now" to try it.' : 'Key removed.');
}

/** Fetches recent papers from the watch list, ranks them against your papers and writes today's insights. */
function runInsights() {
  var ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), me = Session.getEffectiveUser().getEmail();
  var ps = ss.getSheetByName('Papers'), P = cols(ps, PAPER_COLS, ADD_PAPER), pb = block(ps, P);
  var papers = pb.v.filter(function (r) { return str(r[P.key - 1]) && !str(P.override ? r[P.override - 1] : ''); })
    .map(function (r) { return { key: str(r[P.key - 1]), title: P.title ? str(r[P.title - 1]) : '' }; });
  var sh = logSheet(ss, INSIGHTS_SHEET, INSIGHT_HEAD), seen = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 9, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { seen[str(r[0]).replace(/^https?:\/\/doi\.org\//, '').toLowerCase()] = 1; });
  var from = Utilities.formatDate(new Date(Date.now() - 35 * 864e5), tz, 'yyyy-MM-dd'), items = [], failed = 0;
  var get = function (list) {
    return UrlFetchApp.fetchAll(list.map(function (j) { return { url: rdCrossrefUrl(j.issn[0], from, me), muteHttpExceptions: true }; }));
  };
  for (var i = 0; i < RD_WATCH.length; i += 5) {
    var batch = RD_WATCH.slice(i, i + 5), res = get(batch);
    res.forEach(function (r, k) {
      if (r.getResponseCode() !== 200) { Utilities.sleep(800); r = get([batch[k]])[0]; }
      if (r.getResponseCode() !== 200) { failed++; return; }
      try { items = items.concat(rdCrossrefItems(JSON.parse(r.getContentText()), batch[k])); } catch (e) { failed++; }
    });
  }
  var props = PropertiesService.getScriptProperties(), gKey = props.getProperty('GEMINI_API_KEY'), cKey = props.getProperty('CLAUDE_API_KEY');
  var picked = rdRankInsights(items, papers, seen, gKey || cKey ? 15 : 5), by = 'RD SK', ai = null;
  if (picked.length && gKey) { ai = geminiIdeas(gKey, picked, papers); if (ai) by = 'Gemini'; }
  if (picked.length && !ai && cKey) { ai = claudeIdeas(cKey, picked, papers); if (ai) by = 'Claude'; }
  picked = ai || picked.slice(0, 5);
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = picked.map(function (x, n) {
    return [today, n + 1, x.title, x.authors, x.journal, x.abdc, x.ft50 ? 'FT50' : '', x.published, 'https://doi.org/' + x.doi, x.paper,
            x.why, x.tip, String(x.abstract || '').slice(0, 3000), by, ''];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, INSIGHT_HEAD.length).setValues(rows);
  return { count: rows.length, summary: rows.length + ' insights from ' + items.length + ' recent papers in ' + (RD_WATCH.length - failed) +
           ' journals' + (by !== 'RD SK' ? ' (ideas written by ' + by + ')' : '') + '.' };
}

/** Claude picks the 5 most useful of the shortlist and writes why it matters and a concrete next study. Null on any problem. */
function ideasPrompt(shortlist, papers) {
  return 'You are helping an academic in communication, discourse and organization studies (continental philosophy, critical ' +
    'discourse analysis, AI-mediated communication, ethics) stay current and find research gaps.\n\nTheir papers (short name: title):\n' +
    papers.map(function (p) { return '- ' + p.key + ': ' + (p.title || p.key); }).join('\n') +
    '\n\nRecently published candidates:\n' + shortlist.map(function (x) {
      return 'DOI ' + x.doi + ' | ' + x.journal + (x.abdc ? ' (ABDC ' + x.abdc + ')' : '') + ' | ' + x.title + '\nAbstract: ' + (x.abstract || '(none)').slice(0, 1200);
    }).join('\n\n') +
    '\n\nPick the 5 candidates most useful for their next papers (prefer variety across their papers). For each give: doi (exactly as ' +
    'given); related_paper (one short name from their list); why_relevant (1-2 sentences on what the study found or argues and how it ' +
    'connects to that paper); next_study (2-3 sentences: a specific, feasible study they could write next that fills a gap this paper ' +
    'leaves open, with research question, method and setting). Be concrete; do not invent findings beyond the abstract.';
}

/** Maps the model's {insights:[...]} answer back onto the shortlist; null unless at least 3 usable picks. */
function ideasFrom(json, shortlist) {
  var out = (json && json.insights) || [], byDoi = {};
  shortlist.forEach(function (x) { byDoi[x.doi] = x; });
  var picked = out.filter(function (o) { return o && byDoi[String(o.doi).toLowerCase()]; }).slice(0, 5).map(function (o) {
    var x = byDoi[String(o.doi).toLowerCase()], y = {};
    Object.keys(x).forEach(function (k) { y[k] = x[k]; });
    y.paper = o.related_paper; y.why = o.why_relevant; y.tip = o.next_study;
    return y;
  });
  return picked.length >= 3 ? picked : null;
}

/** Free Gemini models the key can use, best first: known free Flash models, then any other Flash model it lists. */
var GEMINI_FREE = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
function geminiModels(key) {
  var fixed = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL');
  if (fixed) return [fixed];
  try {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return GEMINI_FREE.slice();
    var names = (JSON.parse(r.getContentText()).models || []).filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
    }).map(function (m) { return String(m.name).replace(/^models\//, ''); });
    var known = GEMINI_FREE.filter(function (n) { return names.indexOf(n) >= 0; });
    var flash = names.filter(function (n) { return /^gemini-[\d.]+-flash(-lite)?$/.test(n) && known.indexOf(n) < 0; }).sort(function (a, b) {
      return parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]) || a.length - b.length; });
    var all = known.concat(flash);
    return all.length ? all : GEMINI_FREE.slice();
  } catch (e) {
    return GEMINI_FREE.slice();
  }
}
function geminiModel(key) { return geminiModels(key)[0]; }

/** Gemini (free tier) picks the 5 most useful of the shortlist and writes the ideas. Null on any problem (e.g. daily quota). */
function geminiIdeas(key, shortlist, papers) {
  var schema = { type: 'OBJECT', required: ['insights'], properties: { insights: { type: 'ARRAY', items: { type: 'OBJECT',
    required: ['doi', 'related_paper', 'why_relevant', 'next_study'],
    properties: { doi: { type: 'STRING' }, related_paper: { type: 'STRING' }, why_relevant: { type: 'STRING' }, next_study: { type: 'STRING' } } } } } };
  try {
    var model = geminiModel(key);
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ parts: [{ text: ideasPrompt(shortlist, papers) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }) });
    if (r.getResponseCode() !== 200) return null;
    var res = JSON.parse(r.getContentText()), c = (res.candidates || [])[0];
    var text = c && c.content ? (c.content.parts || []).map(function (p) { return p.text || ''; }).join('') : '';
    return text ? ideasFrom(JSON.parse(text), shortlist) : null;
  } catch (e) {
    return null;
  }
}

function claudeIdeas(key, shortlist, papers) {
  var schema = { type: 'object', additionalProperties: false, required: ['insights'], properties: { insights: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['doi', 'related_paper', 'why_relevant', 'next_study'],
    properties: { doi: { type: 'string' }, related_paper: { type: 'string' }, why_relevant: { type: 'string' }, next_study: { type: 'string' } } } } } };
  var prompt = ideasPrompt(shortlist, papers);
  try {
    var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      payload: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 16000, fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
        messages: [{ role: 'user', content: prompt }] }) });
    if (r.getResponseCode() !== 200) return null;
    var msg = JSON.parse(r.getContentText());
    if (msg.stop_reason === 'refusal') return null;
    var text = (msg.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    return ideasFrom(JSON.parse(text), shortlist);
  } catch (e) {
    return null;
  }
}

/** The last 14 days of insights for the app; `saved` = DOIs starred in the app. */
function insightRows(ss, saved) {
  var sh = ss.getSheetByName(INSIGHTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var rg = sh.getRange(2, 1, sh.getLastRow() - 1, INSIGHT_HEAD.length), v = rg.getValues(), star = {}, dirty = false;
  saved.forEach(function (d) { star[String(d).toLowerCase()] = 1; });
  var since = Date.now() - 14 * 864e5, tz = ss.getSpreadsheetTimeZone(), out = [];
  v.forEach(function (r) {
    var doi = str(r[8]).replace(/^https?:\/\/doi\.org\//, '').toLowerCase();
    if (star[doi] && str(r[14]) !== 'Yes') { r[14] = 'Yes'; dirty = true; }
    var d = r[0] instanceof Date ? r[0] : new Date(Date.parse(str(r[0])));
    if (d.getTime() < since && str(r[14]) !== 'Yes') return;
    out.push({ date: day(r[0], tz) || str(r[0]), rank: +r[1] || 0, title: str(r[2]), authors: str(r[3]), journal: str(r[4]), abdc: str(r[5]),
               ft50: !!str(r[6]), published: day(r[7], tz) || str(r[7]), doi: doi, paper: str(r[9]), why: str(r[10]), tip: str(r[11]),
               abstract: str(r[12]).slice(0, 1500), by: str(r[13]), saved: str(r[14]) === 'Yes' });
  });
  if (dirty) rg.setValues(v);
  return out.slice(-60);
}

// ==== current-data.json (copied from data/ by tools/make_gscript.py; made by tools/sheet2_import.py) ====
var RD_CURRENT = {"source":"SK_Research_Updates_2026.xlsx, Sheet 2","asOf":"2026-10-22","papers":[{"id":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","key":"‘One dies’: Blanchot & organizational speech","title":"‘One dies’: Blanchot, the impossibility of death and the unworking of organizational speech","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Asian Journal of Communication (IF 2.5); Human Relations; Philosophy & Social Criticism; Communications The European Journal of Communication Research; Critical Horizons (Q2); Mortality (Q1 T&F); Journal of the British Society for Phenomenology; Research in Phenomenology; Eidos. A Journal for Philosophy of Culture; Research in Phenomenology first, then Angelaki, then Continental Philosophy Review"},{"id":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","key":"The Time That Obligates (Derrida–Levinas)","title":"The Time That Obligates: Derrida, Levinas, and a Hauntological Ethics of Memory","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Sociological Inquiry; Philosophy & Social Criticism (Q1(Philosophy)); Angelaki (Q1); Ethos; Theoria; The Southern Journal of Philosophy; Journal of Social Philosophy (SSCI); Theoretical Studies in Literature and Art (Q2 Literature Arts); Conatus - Journal of Philosophy (Q2); Oxford Literary Review (Q4); The Sociological Review; Social Science Information; Contemporary Sociology; The Social Science Journal; History and theory; Human Studies; Studies in East European Thought; social semiotics; Journal of the Philosophy of History; History & Memory; https://www.pdcnet.org/jpr/Indexing-and-Abstracting; Asian Journal of Philosophy; https://www.tandfonline.com/journals/rrhi20/about-this-journal; Rethinking History"},{"id":"5cb222c1-714f-53cb-a93d-917d2213410c","key":"Coffee with the Machine (EPW)","title":"Coffee with the Machine: Sipping Meaning from Digital Tributaries","authors":"","type":"EPW / short piece","override":"","notes":"Shortlist (Sheet 2): Short Fiction in Theory & Practice; Manoa: A Pacific Journal of International Writing (ESCI); New Writing: The International Journal for the Practice and Theory of Creative Writing"},{"id":"1374ff86-f8fb-5d94-beb9-782c1f32f5d9","key":"Cockroaches, Not Citizens (CDA)","title":"Cockroaches, Not Citizens: A Critical-Generational-Socio-Cognitive Discourse Analysis of Delegitimization of India’s Cockroach Janta Party","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Alternatives: global, local, political; Political Communication; Journal of communication"},{"id":"52c79634-15a6-5dad-9d0d-03407887d62c","key":"Distributed securitization (India SIR)","title":"Distributed securitization: threat and procedure in India’s Special Intensive Revision of electoral rolls","authors":"Kaushal, S., Guha, A., Dhammi, S.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Security Studies; European Journal of International Relations; Millennium: Journal of International Studies"},{"id":"86cad934-2ae1-5512-95e8-40e1942ac34f","key":"Bullshit without a bullshitter (GenAI)","title":"Bullshit Without a Bullshitter: Generative AI and the Problem of Authorless Authority in Organizations","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Human Relations"},{"id":"dddda04b-b1ea-50e5-9db3-e5faae6a189c","key":"The algorithmic vernacular (AI co-authorship)","title":"The algorithmic vernacular: how AI co-authors organizational language","authors":"","type":"Journal article","override":"","notes":""},{"id":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","key":"Algorithmic silence & org. power","title":"Algorithmic silence and organizational power: digital erasure and the politics of absence","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Media, Culture & Society; Research in the Sociology of Organizations; New Technology, Work and Employment; Journal of Management Inquiry; Culture and Organization; New Technology, Work & Employment; Human Relations; Journal of Management Studies (FT50); Academy of Management Review (FT50)"},{"id":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","key":"Intentional tacit knowledge hiding (Malawi)","title":"Intentional Tacit Knowledge Hiding in Public Service: Evidence from Former Principal Secretaries in Malawi","authors":"Nyoni, A.M., Kaushal, S., Kovid, R.K., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Group & Organization Management; Journal of African Business; Personnel Review; Business Information Review (Q2)"},{"id":"0cadaf1f-4986-58f6-9b42-68311b9dace3","key":"Who Spoke? (AI attribution)","title":"Who Spoke? Attribution Distortion and the Split Production Format of AI-Assisted Communication","authors":"Guha, A., Kaushal, S.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Journal of Computer-Mediated Communication (SSCI IF 7.4 5YR IF 11); European Journal of Communication; Journal of Communication; Written Communication"},{"id":"600c1a97-c47f-5b90-ac87-a1b795ec0cde","key":"The Right to the Secret (Foucault–Derrida)","title":"Right to the Secret (Foucault Derrida)","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Philosophy of Management"},{"id":"fc7895d7-8188-5c24-8e40-68dada5753a9","key":"Who gets named?","title":"Who gets Named?","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":""},{"id":"5af54582-e2ef-58c6-b689-f20edb8962f1","key":"Organizational Silence (lit review)","title":"Organizational Silence (Lit Review)","authors":"Kaushal, S.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Journal of Information, Communication and Ethics in Society; Ethics and Information Technology; Journal of Business Ethics; Business Ethics Quarterly; Personnel Review; Employee Relations; Culture and Organization; Corporate Communications: An International Journal; Journal of Management Inquiry"},{"id":"5dc98f54-1274-52bd-9fa1-041b402b1917","key":"Whose grief is political?","title":"Whose grief is political? Grieving rules and the securitization of mourning in Indian news media","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":""},{"id":"c9e08693-cc08-599f-b79d-f45684adf275","key":"Assessing in Whose Language?","title":"Assessing in Whose Language?","authors":"Guha, A., Kaushal, S.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Journal of Educational Administration; EMAL; EPW (Special Article); RELC Journal (IF 5.9); Educational Management, Administration & Leadership; Assessment in Education (IF 3.9)"},{"id":"66cf11b1-be3d-5dff-8853-225dea3f66fe","key":"Hedging machines: a systematic review","title":"Hedging machines: a systematic review","authors":"Kaushal, S.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Behaviour and Information Technology"},{"id":"3eeae546-b4da-5b8a-af1d-6daafd1d1a0f","key":"Is the Apology the Same Size?","title":"Is the Apology the Same Size?","authors":"Kaushal, S.","type":"Journal article","override":"","notes":""},{"id":"00931f49-46be-5636-8de5-1a6aba1aec6a","key":"Can Virtue Be Advertised?","title":"Can Virtue Be Advertised?","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":""},{"id":"ac1f69e3-c86c-5b85-8b36-639da5ab6868","key":"We Are Family? (corporate kinship talk)","title":"We Are Family? Corporate Kinship Talk","authors":"Guha, A., Kaushal, S.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Philosophy of Management"},{"id":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","key":"Farmers’ protest & radical passivity","title":"Farmers’ Protest and the Language of Radical Passivity: An Analytic Framework for Ethical Protest Communication","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Journal of Communication Management; Social Movement Studies (SSCI IF 2.5); Management Communication Quarterly; Speech Communication; Language and Communication; Critical Asian Studies; Journal of Social Issues; Theory, Culture and Society; Global Knowledge, Memory and Communication; International Journal of Strategic Communication; Applied Linguistics Review (SSCI 2.3); Research on Language and Social Interaction (SSCI IF 3 Q1); Journal of Information, Communication and Ethics in Society; Communication and Critical/Cultural Studies"},{"id":"10f4f083-68d8-5fa0-9a41-0a8558e48812","key":"Is Leadership Inherently Violent?","title":"Is Leadership Inherently Violent? Sovereignty, Precarity, and the Ethics of Organizational Authority","authors":"Kaushal, S., Guha, A.","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): Journal of Leadership and Organizational Studies; Human Relations; The Leadership Quarterly; Business Ethics Quarterly; Ethics; Leadership"},{"id":"f348da90-418c-5247-b391-187617445584","key":"Cosmeceutical R&D trajectories (text mining)","title":"Methodological Trajectories as Technology Intelligence: Mapping Capability Shifts in Cosmeceutical R&D Through Text Mining of the Scientific Literature, 2014–2025","authors":"","type":"Journal article","override":"","notes":"Shortlist (Sheet 2): https://journals.sagepub.com/home/con; https://link.springer.com/journal/41287; https://meth.psychopen.eu/index.php/meth; https://www.tandfonline.com/journals/titd20/about-this-journal; https://www.tandfonline.com/journals/tsrm20/about-this-journal; https://link.springer.com/journal/13755; Technology in Society- 12.5 (IF SSCI); R&D Management; Social Science & Medicine; Foresight; Information Discovery and Delivery; Technology Analysis and Strategic Management"}],"subs":[{"id":"def3a8d6-7ef5-529d-b554-20c6fd31af44","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Theory, Culture and Society","rating":"","status":"Rejected","submitted":"2024-06-20","decided":"2024-11-11","notes":"Rejected with 6 reviews; stages in Sheet 2: 2024-06-20→2024-06-27, 2024-06-27→2024-11-11","titleUsed":""},{"id":"8a6b4996-ccaa-53f6-b589-47f361bb48d5","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Communication Monographs","rating":"","status":"Rejected","submitted":"2024-12-04","decided":"2024-12-07","notes":"","titleUsed":""},{"id":"73645992-f925-57f2-b945-cc67c4a56a8a","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Language and Communication","rating":"","status":"Rejected","submitted":"2024-12-30","decided":"2025-04-11","notes":"","titleUsed":""},{"id":"22ea27dc-0b47-5986-a6aa-b05ff3d7baf2","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Philosophy of the Social Sciences","rating":"","status":"Rejected","submitted":"2025-04-14","decided":"2025-04-14","notes":"","titleUsed":""},{"id":"2fef485a-3ea7-5faf-8cc0-fdd81ef404fd","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Journal of Communication","rating":"","status":"Rejected","submitted":"2025-04-14","decided":"2025-04-15","notes":"","titleUsed":""},{"id":"4d26c474-c348-5771-8375-8cbf2b82f36b","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"European Journal of Communication","rating":"","status":"Rejected","submitted":"2025-05-02","decided":"2025-05-27","notes":"","titleUsed":""},{"id":"e3b4c677-d454-55a7-97f2-851f52dddb79","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Comparative and Continental Philosophy","rating":"Q4","status":"Under review","submitted":"2025-06-04","decided":"","notes":"","titleUsed":""},{"id":"f8247f36-6369-5c6a-b4d5-9b3b1c629ccf","paper":"09b190cd-ae0f-5867-a2a3-43958f45d8c8","journal":"Organization","rating":"","status":"Under review","submitted":"2026-10-01","decided":"","notes":"","titleUsed":""},{"id":"b8c46558-ea70-5727-b603-2ecb265f1579","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Time and Society","rating":"","status":"Rejected","submitted":"2024-06-14","decided":"2024-06-21","notes":"","titleUsed":""},{"id":"4798a04c-a4b6-5ed7-a0d8-e8d1bfbe2813","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Philosophy of the Social Sciences","rating":"","status":"Rejected","submitted":"2024-06-21","decided":"2024-06-21","notes":"","titleUsed":""},{"id":"30abe3e6-9379-5d96-a80c-d173de2bea1d","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Ethics","rating":"","status":"Rejected","submitted":"2024-06-21","decided":"2024-06-24","notes":"","titleUsed":""},{"id":"efc492d0-3b5e-52cd-98c1-083752e7e133","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Critical Quarterly","rating":"Q2","status":"Rejected","submitted":"2024-06-25","decided":"2024-10-01","notes":"","titleUsed":""},{"id":"36754f6d-6eab-500f-9fd6-03bf3002f92e","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"History of European Ideas","rating":"","status":"Rejected","submitted":"2024-08-27","decided":"2024-08-29","notes":"","titleUsed":""},{"id":"35f457d9-0247-5839-ac7d-f5566552dff6","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Qualitative Inquiry","rating":"Q1 (Socio) SSCI 1.4","status":"Rejected","submitted":"2024-10-01","decided":"2024-10-01","notes":"","titleUsed":""},{"id":"aaae6b92-b1a8-5aa0-a5af-e80916fd1076","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Inquiry","rating":"SSCI","status":"Rejected","submitted":"2024-10-02","decided":"2024-10-06","notes":"","titleUsed":""},{"id":"fd9e8666-1ab8-5dbf-9198-71ec1bfd0270","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Philosophical Explorations","rating":"","status":"Rejected","submitted":"2024-10-14","decided":"2024-10-24","notes":"","titleUsed":""},{"id":"35a7e65f-5d06-5cc5-84e2-f3933adf3455","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Journal of Contemporary European Studies","rating":"SSCI","status":"Rejected","submitted":"2024-12-04","decided":"2024-12-16","notes":"","titleUsed":""},{"id":"fb0fe52b-4f0e-549d-ab46-e8b117d7826e","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Continental Philosophy Review","rating":"","status":"Rejected","submitted":"2025-01-10","decided":"2025-03-30","notes":"","titleUsed":""},{"id":"c5eb025e-1999-5c9a-9f8d-b868bcd49f31","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Global Philosophy","rating":"","status":"Rejected","submitted":"2025-03-31","decided":"2025-04-05","notes":"","titleUsed":""},{"id":"386804d1-83ae-5497-b1e1-ee25762641c2","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Memory Studies","rating":"Q1 (Culture studies)","status":"Rejected","submitted":"2025-04-07","decided":"2025-04-19","notes":"","titleUsed":""},{"id":"aaf1fafe-3738-5cd5-b1cd-c19656aee5f3","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Orbis Litterarum","rating":"","status":"Rejected","submitted":"2025-04-07","decided":"2025-05-20","notes":"","titleUsed":""},{"id":"60b40039-ebc7-5ec3-8a51-0ceea32edd5e","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Journal for Cultural Research","rating":"Q1(Cult)","status":"Rejected","submitted":"2025-04-21","decided":"2025-07-29","notes":"Rejected with reviews","titleUsed":""},{"id":"7d58f325-339f-5358-8e45-509ee35fa945","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"European Journal of Cultural Studies","rating":"SSCI 1.9 IF SAGE","status":"Rejected","submitted":"2025-05-22","decided":"2025-06-20","notes":"","titleUsed":""},{"id":"2da81444-8aa6-5eb5-95a9-b15e4af06b72","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Theory, Culture and Society","rating":"","status":"Rejected","submitted":"2025-06-22","decided":"2025-07-25","notes":"","titleUsed":""},{"id":"24b7e699-5082-515e-bfa9-85ee18c5c483","paper":"ac211d81-f1c3-5289-8fb6-f17c81b739f7","journal":"Time and Society","rating":"","status":"Under review","submitted":"2026-09-24","decided":"","notes":"","titleUsed":""},{"id":"877d0f22-7a95-55e9-8b7a-117596744383","paper":"5cb222c1-714f-53cb-a93d-917d2213410c","journal":"EPW (PostScript)","rating":"","status":"Rejected","submitted":"2025-04-12","decided":"2025-11-04","notes":"","titleUsed":""},{"id":"c11f81ed-c47b-5c2b-890b-710a3cc7bd5b","paper":"1374ff86-f8fb-5d94-beb9-782c1f32f5d9","journal":"EPW (Engage)","rating":"","status":"Rejected","submitted":"2026-06-05","decided":"2026-06-25","notes":"","titleUsed":""},{"id":"f519217e-3e52-5372-b787-3063a1c921d5","paper":"1374ff86-f8fb-5d94-beb9-782c1f32f5d9","journal":"Media, Culture & Society","rating":"","status":"Rejected","submitted":"2026-06-27","decided":"2026-07-01","notes":"","titleUsed":""},{"id":"d55fe046-0eab-52a8-9d21-0f0ba304a1d1","paper":"1374ff86-f8fb-5d94-beb9-782c1f32f5d9","journal":"Discourse and Society","rating":"","status":"Rejected","submitted":"2026-09-30","decided":"2026-09-30","notes":"","titleUsed":""},{"id":"a496302a-6234-5d05-933e-2e750b8ab1ad","paper":"1374ff86-f8fb-5d94-beb9-782c1f32f5d9","journal":"Information, Communication & Society","rating":"","status":"Rejected","submitted":"2026-10-01","decided":"2026-10-04","notes":"","titleUsed":""},{"id":"12dc7a9e-c4b4-5d4e-a8fa-b5118a556827","paper":"1374ff86-f8fb-5d94-beb9-782c1f32f5d9","journal":"Discourse and Communication","rating":"","status":"Under review","submitted":"2026-10-05","decided":"","notes":"","titleUsed":""},{"id":"7ad83906-4f92-56dd-8078-87f0fa6c1eb2","paper":"52c79634-15a6-5dad-9d0d-03407887d62c","journal":"Security Dialogue","rating":"","status":"Under review","submitted":"2026-10-11","decided":"","notes":"","titleUsed":""},{"id":"52ec8ba5-7a3a-57ee-a66f-28fbda6b97f3","paper":"86cad934-2ae1-5512-95e8-40e1942ac34f","journal":"Academy of Management Review","rating":"FT50","status":"Rejected","submitted":"2026-10-05","decided":"2026-10-05","notes":"","titleUsed":""},{"id":"964d640c-6f1c-55df-b71c-86d7b9aaed3d","paper":"86cad934-2ae1-5512-95e8-40e1942ac34f","journal":"Journal of Management Studies","rating":"FT50","status":"Rejected","submitted":"2026-10-12","decided":"2026-10-22","notes":"","titleUsed":""},{"id":"b68de982-9cbb-5707-b340-a6e2715332bc","paper":"86cad934-2ae1-5512-95e8-40e1942ac34f","journal":"Journal of Management Inquiry","rating":"","status":"Under review","submitted":"2026-10-22","decided":"","notes":"","titleUsed":""},{"id":"46820646-0145-5a60-9010-15c7401a1a79","paper":"dddda04b-b1ea-50e5-9db3-e5faae6a189c","journal":"Organization Studies","rating":"","status":"Rejected","submitted":"2025-04-27","decided":"2025-07-15","notes":"","titleUsed":""},{"id":"8cdda31a-c4a7-5699-8218-9159a92dcc25","paper":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","journal":"Organization Studies","rating":"","status":"Rejected","submitted":"2025-07-04","decided":"2025-07-15","notes":"","titleUsed":""},{"id":"279ff98c-d6be-551e-9106-c92e4ba2ecfe","paper":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","journal":"Theory, Culture and Society","rating":"","status":"Rejected","submitted":"2025-07-15","decided":"2026-01-14","notes":"","titleUsed":""},{"id":"16f0314e-cc2d-55b8-bf58-070f80489193","paper":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","journal":"Organization","rating":"","status":"Rejected","submitted":"2026-01-15","decided":"2026-02-10","notes":"stages in Sheet 2: 2026-01-15→2026-01-20, 2026-01-20→2026-02-10","titleUsed":""},{"id":"f6e88141-1aea-5b15-a3aa-4e3672c9a741","paper":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","journal":"Information and Organization","rating":"","status":"Rejected","submitted":"2026-02-10","decided":"2026-02-24","notes":"","titleUsed":""},{"id":"68fe79d0-1db0-5586-9ceb-171f66b66c09","paper":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","journal":"Qualitative Research in Organizations and Management","rating":"","status":"Rejected","submitted":"2026-02-10","decided":"2026-04-20","notes":"stages in Sheet 2: 2026-02-10→2026-02-13, 2026-02-13→2026-04-04, 2026-04-04→2026-04-20","titleUsed":""},{"id":"304f66db-792b-5e5a-8712-9c436fcee504","paper":"9426ed5b-97dd-5a84-ba21-f0eaa90ef273","journal":"Organization Theory","rating":"","status":"Under review","submitted":"2026-05-11","decided":"","notes":"","titleUsed":""},{"id":"cc585fef-1e4e-51db-83ff-6cc127554c6b","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Knowledge Management Research and Practice","rating":"","status":"Rejected","submitted":"2024-05-07","decided":"2024-11-16","notes":"stages in Sheet 2: 2024-05-07→2024-07-10, 2024-07-10→2024-11-16","titleUsed":""},{"id":"208e7be9-865b-5bc8-9414-137101166174","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Journal of Knowledge Management","rating":"","status":"Rejected","submitted":"2025-04-12","decided":"2025-04-12","notes":"","titleUsed":""},{"id":"8c97fa7c-024c-542d-8d08-5b1890895f1d","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"VINE Journal of Information and Knowledge Management Systems","rating":"","status":"Rejected","submitted":"2025-04-12","decided":"2025-04-12","notes":"","titleUsed":""},{"id":"c3e1cad5-7880-52a6-bdb9-8f86e034d0ee","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"International Journal of Public Sector Management","rating":"","status":"Rejected","submitted":"2025-04-14","decided":"2025-06-07","notes":"","titleUsed":""},{"id":"16f6789b-7656-5287-8ccc-311d16bfda32","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"International Journal of Information Management","rating":"","status":"Rejected","submitted":"2025-07-06","decided":"2025-07-06","notes":"","titleUsed":""},{"id":"a83b7ed7-0524-5d9a-ba2e-c53c2b4e7ff1","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Public Management Review","rating":"","status":"Rejected","submitted":"2025-07-07","decided":"2025-07-17","notes":"stages in Sheet 2: 2025-07-07→2025-07-09, 2025-07-09→2025-07-17","titleUsed":""},{"id":"1ac110f1-5513-5586-b910-9b01112e9260","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Review of Public Personnel Administration","rating":"","status":"Rejected","submitted":"2025-07-17","decided":"2025-07-24","notes":"","titleUsed":""},{"id":"8799fd02-00ad-56e3-8665-09da8d91f0a2","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Public Personnel Management","rating":"","status":"Rejected","submitted":"2025-07-25","decided":"2025-07-31","notes":"","titleUsed":""},{"id":"227d8ae5-4e7d-5f6d-a110-b0ea32f70f3e","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Qualitative Research in Organizations and Management","rating":"","status":"Rejected","submitted":"2025-09-03","decided":"2025-09-05","notes":"","titleUsed":""},{"id":"cec7f0bb-73af-58cb-90db-333f4ef61c59","paper":"a5cdbe6e-5599-5f79-8100-ccc6383732ee","journal":"Global Knowledge, Memory and Communication","rating":"","status":"Under review","submitted":"2026-07-29","decided":"","notes":"","titleUsed":""},{"id":"cca1aee2-0a56-5825-8e60-14a091ca690d","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Language and Communication","rating":"","status":"Rejected","submitted":"2026-08-11","decided":"2026-08-25","notes":"","titleUsed":""},{"id":"b0742a0c-7357-5969-8624-bcc863e004b9","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Media, Culture & Society","rating":"","status":"Rejected","submitted":"2026-08-12","decided":"2026-09-14","notes":"","titleUsed":""},{"id":"e7069569-7386-586c-8197-5644f0121be1","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Communication Theory","rating":"","status":"Rejected","submitted":"2026-09-15","decided":"2026-09-17","notes":"","titleUsed":""},{"id":"64787591-ee56-5f26-9bdf-e59181993cb8","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Journal of Information, Communication and Ethics in Society","rating":"","status":"Rejected","submitted":"2026-09-18","decided":"2026-09-17","notes":"","titleUsed":""},{"id":"af024a26-4d61-5c89-8321-b4a36bce7f7f","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Information, Communication & Society","rating":"","status":"Rejected","submitted":"2026-10-05","decided":"2026-10-10","notes":"","titleUsed":""},{"id":"9b452f0d-df45-5045-9c81-11fb458fe403","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Communication Research","rating":"","status":"Rejected","submitted":"2026-10-12","decided":"2026-10-22","notes":"","titleUsed":""},{"id":"538e89e5-ec38-52ca-9406-b4c6d37bba04","paper":"0cadaf1f-4986-58f6-9b42-68311b9dace3","journal":"Ethics and Information Technology","rating":"","status":"Under review","submitted":"2026-10-23","decided":"","notes":"","titleUsed":""},{"id":"f106205c-dc40-5f13-833e-20b0d8152165","paper":"600c1a97-c47f-5b90-ac87-a1b795ec0cde","journal":"Human Relations","rating":"","status":"Under review","submitted":"2026-10-14","decided":"","notes":"","titleUsed":""},{"id":"4fa31770-bb9a-5bfa-9b17-0b428a7de299","paper":"fc7895d7-8188-5c24-8e40-68dada5753a9","journal":"Political Communication","rating":"","status":"Planned","submitted":"","decided":"","notes":"","titleUsed":""},{"id":"e6927062-e1fd-5d39-8850-10601c751f6f","paper":"5af54582-e2ef-58c6-b689-f20edb8962f1","journal":"Organization","rating":"","status":"Under review","submitted":"2026-10-20","decided":"","notes":"","titleUsed":""},{"id":"0bc0e35f-bc25-5109-97fa-2cc6c4d441e4","paper":"5dc98f54-1274-52bd-9fa1-041b402b1917","journal":"Security Studies","rating":"","status":"Planned","submitted":"","decided":"","notes":"","titleUsed":""},{"id":"56f68927-2f94-5e24-8041-40a6ae791ffa","paper":"c9e08693-cc08-599f-b79d-f45684adf275","journal":"International Journal of Educational Management","rating":"","status":"Under review","submitted":"2026-10-20","decided":"","notes":"","titleUsed":""},{"id":"44ae5932-1822-522b-8b01-824988f6c794","paper":"66cf11b1-be3d-5dff-8853-225dea3f66fe","journal":"International Journal of Information Management","rating":"","status":"Planned","submitted":"","decided":"","notes":"","titleUsed":""},{"id":"5971f7a5-56e2-5739-8468-7a8a5aa1e2bd","paper":"3eeae546-b4da-5b8a-af1d-6daafd1d1a0f","journal":"Philosophy of Management","rating":"","status":"Under review","submitted":"2026-10-22","decided":"","notes":"","titleUsed":""},{"id":"0854abea-b5d2-55c6-9b78-5e523b599b73","paper":"00931f49-46be-5636-8de5-1a6aba1aec6a","journal":"Journal of Markets & Morality","rating":"","status":"Under review","submitted":"2026-10-22","decided":"","notes":"","titleUsed":""},{"id":"337875e8-5d39-537b-b36b-b701a3fa7d28","paper":"ac1f69e3-c86c-5b85-8b36-639da5ab6868","journal":"Business Ethics Quarterly","rating":"","status":"Under review","submitted":"2026-10-22","decided":"","notes":"","titleUsed":""},{"id":"5a9d344c-1b5c-5463-81e5-829700c4011d","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Communication Research","rating":"","status":"Rejected","submitted":"2024-07-27","decided":"2024-08-07","notes":"","titleUsed":""},{"id":"d57a2fd3-a04f-5d96-9d40-fbcd93cb2c9c","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Communication Monographs","rating":"","status":"Rejected","submitted":"2024-08-08","decided":"2024-08-14","notes":"","titleUsed":""},{"id":"93903db8-9142-519f-ac6c-f57bb4000590","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Sociological Inquiry","rating":"","status":"Rejected","submitted":"2024-08-14","decided":"2024-08-20","notes":"","titleUsed":""},{"id":"3dffd469-e717-50f5-9ed2-5b53fa825600","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Journal of Peasant Studies","rating":"SSCI IF 4.4  25%","status":"Rejected","submitted":"2024-08-21","decided":"2024-08-28","notes":"","titleUsed":""},{"id":"0aea0be3-0faa-5889-9394-39e0aafa8915","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Philosophy of the Social Sciences","rating":"","status":"Rejected","submitted":"2024-08-21","decided":"2024-08-21","notes":"","titleUsed":""},{"id":"be1669cc-8f46-55dd-9a79-9bcd25498c73","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Philosophy & Public Affairs","rating":"","status":"Rejected","submitted":"2024-08-21","decided":"2024-10-12","notes":"","titleUsed":""},{"id":"e60469e3-7408-5458-985b-d8d8ac577ae5","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Poetics: Journal of Empirical Research on Culture, Media and the Arts","rating":"","status":"Rejected","submitted":"2024-08-21","decided":"2024-09-20","notes":"stages in Sheet 2: 2024-08-21→2024-08-26, 2024-08-26→2024-09-20","titleUsed":""},{"id":"4a4e5849-5ac9-50ce-ba51-604f824155e7","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Qualitative Inquiry","rating":"SSCI  0.82","status":"Rejected","submitted":"","decided":"2024-10-11","notes":"","titleUsed":""},{"id":"7b3c849a-5984-5ec7-8a2a-d5e659e8ed33","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Applied Linguistics","rating":"SSCI 4.8","status":"Revision resubmitted","submitted":"2024-12-04","decided":"2025-07-30","notes":"Awaiting Reviewer Scores; Major revision","titleUsed":""},{"id":"0bbdbadb-908f-5de7-bd46-5b2f92ab7178","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Communication Methods and Measures","rating":"SSCI IF6.3 Q1","status":"Rejected","submitted":"2025-05-05","decided":"2025-05-05","notes":"","titleUsed":""},{"id":"37c387af-c3a2-5ab0-87b1-6a3989dfda48","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Journal of Applied Communication Research","rating":"","status":"Rejected","submitted":"2025-05-07","decided":"2025-05-19","notes":"","titleUsed":""},{"id":"c9047af4-905a-5be2-a566-cd590b7e4d23","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Applied Linguistics","rating":"SSCI 4.8","status":"Under review","submitted":"2026-01-23","decided":"","notes":"Revised version resubmitted","titleUsed":""},{"id":"f5468e99-96da-5f5d-9b80-d7fb67b5f90c","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Discourse and Communication","rating":"","status":"Rejected","submitted":"2026-09-08","decided":"2026-09-14","notes":"","titleUsed":""},{"id":"beeebec7-5a93-5d47-8f2e-3ff5d0a618b3","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Critical Discourse Studies","rating":"","status":"Rejected","submitted":"2026-09-15","decided":"2026-09-16","notes":"","titleUsed":""},{"id":"be1c6319-7a11-58c4-a018-9ab7fb76af41","paper":"7fd7b6eb-b582-5ddb-89e4-12747a91c08d","journal":"Communication Theory","rating":"","status":"Planned","submitted":"","decided":"","notes":"drafted","titleUsed":""},{"id":"e6024fbf-059a-59e1-9af0-2e015c3483e5","paper":"10f4f083-68d8-5fa0-9a41-0a8558e48812","journal":"Journal of Business Ethics","rating":"","status":"Under review","submitted":"2026-10-05","decided":"","notes":"","titleUsed":""},{"id":"6325453f-7cd8-54e6-825d-e9b8ec30379e","paper":"f348da90-418c-5247-b391-187617445584","journal":"Technological Forecasting and Social Change","rating":"","status":"Rejected","submitted":"2026-02-18","decided":"2026-03-12","notes":"","titleUsed":""},{"id":"21e0a8bb-6293-55c9-a9f4-ad4c88734da7","paper":"f348da90-418c-5247-b391-187617445584","journal":"Scientometrics","rating":"","status":"Rejected","submitted":"2026-06-12","decided":"2026-06-26","notes":"","titleUsed":""},{"id":"357f68af-e5e1-5861-a216-d62ae2285003","paper":"f348da90-418c-5247-b391-187617445584","journal":"IEEE Transactions on Engineering Management","rating":"","status":"Rejected","submitted":"2026-10-08","decided":"2026-10-13","notes":"","titleUsed":""}]};
// ==== end current-data.json ====

// ==== watchlist.js (copied from the app by tools/make_gscript.py; edit it there) ====
// Journals scanned for daily research insights (built by tools/build_watchlist.py).
var RD_WATCH = [{"name":"Academy of Management Review","abdc":"A*","ft50":true,"mine":true,"issn":["0363-7425","1930-3807"]},{"name":"Human Relations","abdc":"A*","ft50":true,"mine":true,"issn":["0018-7267","1741-282X"]},{"name":"Journal of Business Ethics","abdc":"A","ft50":true,"mine":true,"issn":["0167-4544","1573-0697"]},{"name":"Journal of Management Studies","abdc":"A*","ft50":true,"mine":true,"issn":["0022-2380","1467-6486"]},{"name":"MIT Sloan Management Review","abdc":"A","ft50":true,"mine":true,"issn":["1532-9194","1532-8937"]},{"name":"Organization Studies","abdc":"A*","ft50":true,"mine":true,"issn":["0170-8406","1741-3044"]},{"name":"Alternatives: global, local, political","abdc":"A","ft50":false,"mine":true,"issn":["0304-3754","2163-3150"]},{"name":"Angelaki","abdc":"","ft50":false,"mine":true,"issn":["0969-725X","1469-2899"]},{"name":"Applied Linguistics","abdc":"","ft50":false,"mine":true,"issn":["0142-6001","1477-450X"]},{"name":"Applied Linguistics Review","abdc":"","ft50":false,"mine":true,"issn":["1868-6303","1868-6311"]},{"name":"Asian Journal of Communication","abdc":"","ft50":false,"mine":true,"issn":["0129-2986","1742-0911"]},{"name":"Asian Journal of Philosophy","abdc":"","ft50":false,"mine":true,"issn":["2731-4642"]},{"name":"Business Ethics Quarterly","abdc":"A","ft50":false,"mine":true,"issn":["1052-150X","2153-3326"]},{"name":"Business Information Review","abdc":"","ft50":false,"mine":true,"issn":["0266-3821","1741-6450"]},{"name":"Communication and Critical/Cultural Studies","abdc":"","ft50":false,"mine":true,"issn":["1479-1420","1479-4233"]},{"name":"Communication Methods and Measures","abdc":"","ft50":false,"mine":true,"issn":["1931-2458","1931-2466"]},{"name":"Communication Monographs","abdc":"","ft50":false,"mine":true,"issn":["0363-7751","1479-5787"]},{"name":"Communication Research","abdc":"A","ft50":false,"mine":true,"issn":["0093-6502","1552-3810"]},{"name":"Communication Theory","abdc":"A","ft50":false,"mine":true,"issn":["1050-3293","1468-2885"]},{"name":"Communications: The European Journal of Communication Research","abdc":"","ft50":false,"mine":true,"issn":["0341-2059","1613-4087"]},{"name":"Comparative and Continental Philosophy","abdc":"","ft50":false,"mine":true,"issn":["1757-0638","1757-0646"]},{"name":"Contemporary Sociology","abdc":"C","ft50":false,"mine":true,"issn":["0094-3061","1939-8638"]},{"name":"Continental Philosophy Review","abdc":"","ft50":false,"mine":true,"issn":["1387-2842","1573-1103"]},{"name":"Corporate Communications: An International Journal","abdc":"","ft50":false,"mine":true,"issn":["1356-3289","1758-6046"]},{"name":"Critical Asian Studies","abdc":"B","ft50":false,"mine":true,"issn":["1467-2715","1472-6033"]},{"name":"Critical Discourse Studies","abdc":"B","ft50":false,"mine":true,"issn":["1740-5904","1740-5912"]},{"name":"Critical Horizons","abdc":"","ft50":false,"mine":true,"issn":["1440-9917","1568-5160"]},{"name":"Critical Quarterly (Wiley)","abdc":"","ft50":false,"mine":true,"issn":["0011-1562","1467-8705"]},{"name":"Culture and Organization","abdc":"B","ft50":false,"mine":true,"issn":["1475-9551","1477-2760"]},{"name":"Discourse & Communication","abdc":"A","ft50":false,"mine":true,"issn":["1750-4813","1750-4821"]},{"name":"Discourse & Society","abdc":"A","ft50":false,"mine":true,"issn":["0957-9265","1460-3624"]},{"name":"Discourse Studies","abdc":"A","ft50":false,"mine":true,"issn":["1461-4456","1461-7080"]},{"name":"Eidos: A Journal for Philosophy of Culture","abdc":"","ft50":false,"mine":true,"issn":["1692-8857","2011-7477"]},{"name":"Employee Relations","abdc":"A","ft50":false,"mine":true,"issn":["0142-5455","1758-7069"]},{"name":"Ethics and Information Technology","abdc":"B","ft50":false,"mine":true,"issn":["1388-1957","1572-8439"]},{"name":"Ethics: an international journal of social, political, and legal philosophy","abdc":"A","ft50":false,"mine":true,"issn":["0014-1704","1539-297X"]},{"name":"Ethos","abdc":"","ft50":false,"mine":true,"issn":["0091-2131","1548-1352"]},{"name":"European Journal of Communication","abdc":"B","ft50":false,"mine":true,"issn":["0267-3231","1460-3705"]},{"name":"European Journal of Cultural Studies (Sage)","abdc":"","ft50":false,"mine":true,"issn":["1367-5494","1460-3551"]},{"name":"Foresight","abdc":"C","ft50":false,"mine":true,"issn":["1463-6689","1465-9832"]},{"name":"Global Knowledge, Memory and Communication","abdc":"B","ft50":false,"mine":true,"issn":["2514-9342","2514-9350"]},{"name":"Global Philosophy","abdc":"","ft50":false,"mine":true,"issn":["2948-152X","2948-1538"]},{"name":"Group & Organization Management","abdc":"A","ft50":false,"mine":true,"issn":["1059-6011","1552-3993"]},{"name":"History & Memory","abdc":"","ft50":false,"mine":true,"issn":["0935-560X","1527-1994"]},{"name":"History and Theory","abdc":"","ft50":false,"mine":true,"issn":["0018-2656","1468-2303"]},{"name":"History of European Ideas","abdc":"","ft50":false,"mine":true,"issn":["0191-6599","1873-541X"]},{"name":"Human Studies","abdc":"","ft50":false,"mine":true,"issn":["0163-8548","1572-851X"]},{"name":"IEEE Transactions on Engineering Management","abdc":"A","ft50":false,"mine":true,"issn":["1558-0040","0018-9391"]},{"name":"Industrial and Commercial Training","abdc":"","ft50":false,"mine":true,"issn":["0019-7858","1758-5767"]},{"name":"Information and Organization","abdc":"A*","ft50":false,"mine":true,"issn":["1471-7727","1873-7919"]},{"name":"Information Discovery and Delivery","abdc":"C","ft50":false,"mine":true,"issn":["2398-6247","2398-6255"]},{"name":"Information, Communication & Society","abdc":"A","ft50":false,"mine":true,"issn":["1369-118X","1468-4462"]},{"name":"INQUIRY: An Interdisciplinary Journal of Philosophy","abdc":"","ft50":false,"mine":true,"issn":["0020-174X","0020-174X"]},{"name":"International Journal of Educational Management","abdc":"B","ft50":false,"mine":true,"issn":["0951-354X","1758-6518"]},{"name":"International Journal of Information Management","abdc":"A","ft50":false,"mine":true,"issn":["0268-4012","1873-4707"]},{"name":"International Journal of Public Sector Management","abdc":"B","ft50":false,"mine":true,"issn":["0951-3558","1758-6666"]},{"name":"International Journal of Social Research Methodology","abdc":"B","ft50":false,"mine":true,"issn":["1364-5579","1464-5300"]},{"name":"International Journal of Strategic Communication","abdc":"B","ft50":false,"mine":true,"issn":["1553-118X","1553-1198"]},{"name":"Journal for Cultural Research","abdc":"","ft50":false,"mine":true,"issn":["1479-7585","1740-1666"]},{"name":"Journal of African Business","abdc":"C","ft50":false,"mine":true,"issn":["1522-8916","1522-9076"]},{"name":"Journal of Applied Communication Research","abdc":"","ft50":false,"mine":true,"issn":["0090-9882","1479-5752"]},{"name":"Journal of Communication","abdc":"A","ft50":false,"mine":true,"issn":["0021-9916","1460-2466"]},{"name":"Journal of Communication Management","abdc":"B","ft50":false,"mine":true,"issn":["1363-254X","1478-0852"]},{"name":"Journal of Contemporary European Studies","abdc":"","ft50":false,"mine":true,"issn":["1478-2804","1478-2790"]},{"name":"Journal of Information Communication and Ethics in Society","abdc":"B","ft50":false,"mine":true,"issn":["1477-996X","1758-8871"]},{"name":"Journal of Knowledge Management","abdc":"A","ft50":false,"mine":true,"issn":["1367-3270","1758-7484"]},{"name":"Journal of Leadership and Organizational Studies","abdc":"A","ft50":false,"mine":true,"issn":["1548-0518","1939-7089"]},{"name":"Journal of Management Inquiry","abdc":"A","ft50":false,"mine":true,"issn":["1056-4926","1552-6542"]},{"name":"Journal of Markets & Morality","abdc":"B","ft50":false,"mine":true,"issn":["1098-1217","1944-7841"]},{"name":"Journal of Organizational Effectiveness: People and Performance (JOEPP)","abdc":"","ft50":false,"mine":true,"issn":["2051-6614","2051-6622"]},{"name":"Journal of Philosophical Research (pdcnet.org/jpr)","abdc":"","ft50":false,"mine":true,"issn":["1053-8364"]},{"name":"Journal of Social Issues","abdc":"A","ft50":false,"mine":true,"issn":["0022-4537","1540-4560"]},{"name":"Journal of Social Philosophy","abdc":"","ft50":false,"mine":true,"issn":["0047-2786","1467-9833"]},{"name":"Journal of the British Society for Phenomenology (JBSP)","abdc":"","ft50":false,"mine":true,"issn":["0007-1773","2332-0486"]},{"name":"Journal of the Philosophy of History","abdc":"","ft50":false,"mine":true,"issn":["1872-261X","1872-2636"]},{"name":"Knowledge Management Research and Practice","abdc":"A","ft50":false,"mine":true,"issn":["1477-8238","1477-8246"]},{"name":"Language & Communication","abdc":"B","ft50":false,"mine":true,"issn":["0271-5309","1873-3395"]},{"name":"Leadership","abdc":"B","ft50":false,"mine":true,"issn":["1742-7150","1742-7169"]},{"name":"Management Communication Quarterly","abdc":"B","ft50":false,"mine":true,"issn":["0893-3189","1552-6798"]},{"name":"Media Culture and Society","abdc":"B","ft50":false,"mine":true,"issn":["0163-4437","1460-3675"]},{"name":"Memory Studies","abdc":"","ft50":false,"mine":true,"issn":["1750-6980","1750-6999"]},{"name":"Mortality (Death and Dying), T&F","abdc":"","ft50":false,"mine":true,"issn":["1357-6275","1469-9885"]},{"name":"New Technology, Work & Employment","abdc":"A","ft50":false,"mine":true,"issn":["0268-1072","1468-005X"]},{"name":"Orbis Litterarum","abdc":"","ft50":false,"mine":true,"issn":["0105-7510","1600-0730"]},{"name":"Organization","abdc":"A","ft50":false,"mine":true,"issn":["1350-5084","1461-7323"]},{"name":"Organization Theory","abdc":"A","ft50":false,"mine":true,"issn":["2631-7877"]},{"name":"Organization: the critical journal of organization, theory and society","abdc":"","ft50":false,"mine":true,"issn":["1350-5084","1461-7323"]},{"name":"Oxford Literary Review","abdc":"","ft50":false,"mine":true,"issn":["0305-1498","1757-1634"]},{"name":"Personnel Review","abdc":"A","ft50":false,"mine":true,"issn":["0048-3486","1758-6933"]},{"name":"Philosophical Explorations","abdc":"","ft50":false,"mine":true,"issn":["1386-9795","1741-5918"]},{"name":"Philosophy & Public Affairs","abdc":"A","ft50":false,"mine":true,"issn":["0048-3915","1088-4963"]},{"name":"Philosophy & Social Criticism","abdc":"","ft50":false,"mine":true,"issn":["0191-4537","1461-734X"]},{"name":"Philosophy of the Social Sciences","abdc":"B","ft50":false,"mine":true,"issn":["0048-3931","1552-7441"]},{"name":"Poetics","abdc":"","ft50":false,"mine":true,"issn":["0304-422X"]},{"name":"Political Communication","abdc":"A","ft50":false,"mine":true,"issn":["1058-4609","1091-7675"]},{"name":"Public Management Review","abdc":"A","ft50":false,"mine":true,"issn":["1471-9037","1471-9045"]},{"name":"Public Personnel Management","abdc":"B","ft50":false,"mine":true,"issn":["0091-0260","1945-7421"]},{"name":"Qualitative Inquiry","abdc":"","ft50":false,"mine":true,"issn":["1077-8004","1552-7565"]},{"name":"Qualitative Research in Organizations and Management","abdc":"B","ft50":false,"mine":true,"issn":["1746-5648","1746-5656"]},{"name":"R&D Management","abdc":"A","ft50":false,"mine":true,"issn":["0033-6807","1467-9310"]},{"name":"Research in Phenomenology","abdc":"","ft50":false,"mine":true,"issn":["0085-5553","1569-1640"]},{"name":"Research in the Sociology of Organizations","abdc":"B","ft50":false,"mine":true,"issn":["0733-558X"]},{"name":"Research on Language and Social Interaction","abdc":"","ft50":false,"mine":true,"issn":["0835-1813","1532-7973"]},{"name":"Rethinking History","abdc":"","ft50":false,"mine":true,"issn":["1364-2529","1470-1154"]},{"name":"Review of Public Personnel Administration","abdc":"B","ft50":false,"mine":true,"issn":["0734-371X","1552-759X"]},{"name":"Scientometrics","abdc":"A","ft50":false,"mine":true,"issn":["0138-9130","1588-2861"]},{"name":"Security Dialogue","abdc":"A","ft50":false,"mine":true,"issn":["0967-0106","1460-3640"]},{"name":"Security Studies","abdc":"B","ft50":false,"mine":true,"issn":["0963-6412","1556-1852"]},{"name":"Social Movement Studies","abdc":"","ft50":false,"mine":true,"issn":["1474-2837","1474-2829"]},{"name":"Social Science & Medicine","abdc":"A","ft50":false,"mine":true,"issn":["0277-9536","1873-5347"]},{"name":"Social Science Information","abdc":"C","ft50":false,"mine":true,"issn":["0539-0184","1461-7412"]},{"name":"Social Semiotics","abdc":"","ft50":false,"mine":true,"issn":["1035-0330","1470-1219"]},{"name":"Sociological Inquiry","abdc":"A","ft50":false,"mine":true,"issn":["1475-682X"]},{"name":"Speech Communication","abdc":"","ft50":false,"mine":true,"issn":["0167-6393"]},{"name":"Strategic HR Review","abdc":"","ft50":false,"mine":true,"issn":["1475-4398","1475-4398"]},{"name":"Studies in East European Thought","abdc":"","ft50":false,"mine":true,"issn":["0925-9392","1573-0948"]},{"name":"Technological Forecasting and Social Change","abdc":"A","ft50":false,"mine":true,"issn":["0040-1625","1873-5509"]},{"name":"Technology Analysis and Strategic Management","abdc":"B","ft50":false,"mine":true,"issn":["0953-7325","1465-3990"]},{"name":"Technology in Society","abdc":"C","ft50":false,"mine":true,"issn":["0160-791X","1879-3274"]},{"name":"The Journal of Peasant Studies","abdc":"","ft50":false,"mine":true,"issn":["0306-6150","1743-9361"]},{"name":"The Leadership Quarterly","abdc":"A*","ft50":false,"mine":true,"issn":["1048-9843","1873-3409"]},{"name":"The Social Science Journal","abdc":"C","ft50":false,"mine":true,"issn":["0362-3319","1873-5355"]},{"name":"The Sociological Review","abdc":"A","ft50":false,"mine":true,"issn":["0038-0261","1467-954X"]},{"name":"The Southern Journal of Philosophy","abdc":"","ft50":false,"mine":true,"issn":["0038-4283","2041-6962"]},{"name":"Theoria","abdc":"","ft50":false,"mine":true,"issn":["1755-2567","0040-5825"]},{"name":"Theory, Culture and Society","abdc":"","ft50":false,"mine":true,"issn":["0263-2764","1460-3616"]},{"name":"Time and Society","abdc":"B","ft50":false,"mine":true,"issn":["0961-463X","1461-7463"]},{"name":"VINE Journal of Information and Knowledge Management Systems","abdc":"B","ft50":false,"mine":true,"issn":["2059-5891"]},{"name":"Academy of Management Journal","abdc":"A*","ft50":true,"mine":false,"issn":["0001-4273","1948-0989"]},{"name":"Administrative Science Quarterly","abdc":"A*","ft50":true,"mine":false,"issn":["0001-8392","1930-3815"]},{"name":"Entrepreneurship Theory and Practice","abdc":"A*","ft50":true,"mine":false,"issn":["1042-2587","1540-6520"]},{"name":"Harvard Business Review","abdc":"A","ft50":true,"mine":false,"issn":["0017-8012"]},{"name":"Human Resource Management (US)","abdc":"A*","ft50":true,"mine":false,"issn":["0090-4848","1099-050X"]},{"name":"Information Systems Research","abdc":"A*","ft50":true,"mine":false,"issn":["1047-7047","1526-5536"]},{"name":"Journal of Applied Psychology","abdc":"A*","ft50":true,"mine":false,"issn":["0021-9010","1939-1854"]},{"name":"Journal of Consumer Psychology","abdc":"A*","ft50":true,"mine":false,"issn":["1057-7408","1532-7663"]},{"name":"Journal of Consumer Research","abdc":"A*","ft50":true,"mine":false,"issn":["0093-5301","1537-5277"]},{"name":"Journal of International Business Studies","abdc":"A*","ft50":true,"mine":false,"issn":["0047-2506","1478-6990"]},{"name":"Journal of Management","abdc":"A*","ft50":true,"mine":false,"issn":["0149-2063","1557-1211"]},{"name":"Journal of Management Information Systems","abdc":"A*","ft50":true,"mine":false,"issn":["0742-1222","1557-928X"]},{"name":"Journal of Marketing","abdc":"A*","ft50":true,"mine":false,"issn":["0022-2429","1547-7185"]},{"name":"Journal of Marketing Research","abdc":"A*","ft50":true,"mine":false,"issn":["0022-2437","1547-7193"]},{"name":"Journal of the Academy of Marketing Science","abdc":"A*","ft50":true,"mine":false,"issn":["0092-0703","1552-7824"]},{"name":"Marketing Science","abdc":"A*","ft50":true,"mine":false,"issn":["0732-2399","1526-548X"]},{"name":"MIS Quarterly","abdc":"A*","ft50":true,"mine":false,"issn":["0276-7783","2162-9730"]},{"name":"Organization Science","abdc":"A*","ft50":true,"mine":false,"issn":["1047-7039","1526-5455"]},{"name":"Organizational Behavior and Human Decision Processes","abdc":"A*","ft50":true,"mine":false,"issn":["0749-5978","1095-9920"]},{"name":"Research Policy","abdc":"A*","ft50":true,"mine":false,"issn":["0048-7333","1873-7625"]},{"name":"Strategic Management Journal","abdc":"A*","ft50":true,"mine":false,"issn":["0143-2095","1097-0266"]},{"name":"Academy of Marketing Studies Journal","abdc":"B","ft50":false,"mine":false,"issn":["1095-6298","1528-2678"]},{"name":"Accounting, Organizations and Society","abdc":"A*","ft50":false,"mine":false,"issn":["0361-3682","1873-6289"]},{"name":"Agricultural Economics","abdc":"A","ft50":false,"mine":false,"issn":["0169-5150","1574-0862"]},{"name":"American Journal of Agricultural Economics","abdc":"A*","ft50":false,"mine":false,"issn":["0002-9092","1467-8276"]},{"name":"American Journal of Political Science","abdc":"A*","ft50":false,"mine":false,"issn":["0092-5853","1540-5907"]},{"name":"American Journal of Sociology","abdc":"A*","ft50":false,"mine":false,"issn":["0002-9602","1537-5390"]},{"name":"American Political Science Review","abdc":"A*","ft50":false,"mine":false,"issn":["0003-0554","1537-5943"]},{"name":"American Sociological Review","abdc":"A*","ft50":false,"mine":false,"issn":["0003-1224","1939-8271"]},{"name":"Annual Review of Organizational Psychology and Organizational Behavior","abdc":"A*","ft50":false,"mine":false,"issn":["2327-0616"]},{"name":"Annual Review of Sociology","abdc":"A*","ft50":false,"mine":false,"issn":["0360-0572","1545-2115"]},{"name":"Asia Pacific Journal of Marketing and Logistics","abdc":"A","ft50":false,"mine":false,"issn":["1355-5855","1758-4248"]},{"name":"Australasian Marketing Journal","abdc":"A","ft50":false,"mine":false,"issn":["1441-3582","1839-3349"]},{"name":"Australian Journal of Political Science","abdc":"A","ft50":false,"mine":false,"issn":["1036-1146","1363-030X"]},{"name":"Australian Journal of Public Administration","abdc":"A","ft50":false,"mine":false,"issn":["0313-6647","1467-8500"]},{"name":"British Journal of Political Science","abdc":"A*","ft50":false,"mine":false,"issn":["0007-1234","1469-2112"]},{"name":"British Journal of Sociology","abdc":"A","ft50":false,"mine":false,"issn":["0007-1315","1468-4446"]},{"name":"Business Ethics, the Environment & Responsibility","abdc":"B","ft50":false,"mine":false,"issn":["0962-8770","1467-8608"]},{"name":"Canadian Journal of Agricultural Economics / Revue Canadienne d Agroeconomie","abdc":"A","ft50":false,"mine":false,"issn":["0008-3976","1744-7976"]},{"name":"Communication & Sport","abdc":"B","ft50":false,"mine":false,"issn":["2167-4809","2167-4795"]},{"name":"Communications in Statistics: Theory and Methods","abdc":"B","ft50":false,"mine":false,"issn":["0361-0926","1532-415X"]},{"name":"Communications of the Association for Information Systems","abdc":"A","ft50":false,"mine":false,"issn":["1529-3181"]},{"name":"Comparative Political Studies","abdc":"A","ft50":false,"mine":false,"issn":["0010-4140","1552-3829"]},{"name":"Comparative Politics","abdc":"A","ft50":false,"mine":false,"issn":["0010-4159","2151-6227"]},{"name":"Competition and Consumer Law Journal","abdc":"A","ft50":false,"mine":false,"issn":["1039-5598"]},{"name":"Corporate Communications","abdc":"B","ft50":false,"mine":false,"issn":["1356-3289","1758-6046"]},{"name":"Critical Finance Review","abdc":"A*","ft50":false,"mine":false,"issn":["2164-5744","2164-5760"]},{"name":"Critical Perspectives on Accounting","abdc":"A","ft50":false,"mine":false,"issn":["1045-2354","1095-9955"]},{"name":"Economic Development and Cultural Change","abdc":"A","ft50":false,"mine":false,"issn":["0013-0079","1539-2988"]},{"name":"Economics & Politics","abdc":"A","ft50":false,"mine":false,"issn":["0954-1985","1468-0343"]},{"name":"Economics and Philosophy","abdc":"A","ft50":false,"mine":false,"issn":["0266-2671","1474-0028"]},{"name":"Educational Management Administration & Leadership","abdc":"B","ft50":false,"mine":false,"issn":["1741-1432","1741-1440"]},{"name":"European Business Organization Law Review","abdc":"B","ft50":false,"mine":false,"issn":["1566-7529","1741-6205"]},{"name":"European Journal of Marketing","abdc":"A*","ft50":false,"mine":false,"issn":["0309-0566","1758-7123"]},{"name":"European Journal of Political Economy","abdc":"A","ft50":false,"mine":false,"issn":["0176-2680","1873-5703"]},{"name":"European Journal of Political Research","abdc":"A","ft50":false,"mine":false,"issn":["0304-4130","1475-6765"]},{"name":"European Journal of Work and Organizational Psychology","abdc":"A","ft50":false,"mine":false,"issn":["1359-432X","1464-0643"]},{"name":"European Review of Agricultural Economics","abdc":"A","ft50":false,"mine":false,"issn":["0165-1587","1464-3618"]},{"name":"Gender, Work and Organization","abdc":"A","ft50":false,"mine":false,"issn":["0968-6673","1468-0432"]},{"name":"Health Communication","abdc":"B","ft50":false,"mine":false,"issn":["1041-0236","1532-7027"]},{"name":"Health Marketing Quarterly","abdc":"B","ft50":false,"mine":false,"issn":["0735-9683","1545-0864"]},{"name":"History of Political Economy","abdc":"A","ft50":false,"mine":false,"issn":["0018-2702","1527-1919"]},{"name":"IEEE Transactions on Professional Communication","abdc":"B","ft50":false,"mine":false,"issn":["0361-1434","1558-1500"]},{"name":"Industrial and Organizational Psychology: perspectives on science & practice","abdc":"B","ft50":false,"mine":false,"issn":["1754-9426","1754-9434"]},{"name":"Industrial Marketing Management","abdc":"A*","ft50":false,"mine":false,"issn":["0019-8501","1873-2062"]},{"name":"Information and Communications Technology Law","abdc":"B","ft50":false,"mine":false,"issn":["1360-0834","1469-8404"]},{"name":"Innovation: Organization & Management","abdc":"B","ft50":false,"mine":false,"issn":["1447-9338","2204-0226"]},{"name":"International Environmental Agreements: Politics, Law and Economics","abdc":"A","ft50":false,"mine":false,"issn":["1567-9764","1573-1553"]},{"name":"International Journal of Advertising","abdc":"A","ft50":false,"mine":false,"issn":["0265-0487","1759-3948"]},{"name":"International Journal of Bank Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0265-2323","1758-5937"]},{"name":"International Journal of Consumer Studies","abdc":"A","ft50":false,"mine":false,"issn":["1470-6423","1470-6431"]},{"name":"International Journal of Cultural Policy","abdc":"A","ft50":false,"mine":false,"issn":["1028-6632","1477-2833"]},{"name":"International Journal of Industrial Organization","abdc":"A*","ft50":false,"mine":false,"issn":["0167-7187","1873-7986"]},{"name":"International Journal of Organizational Analysis","abdc":"B","ft50":false,"mine":false,"issn":["1934-8835","1758-8561"]},{"name":"International Journal of Research in Marketing","abdc":"A*","ft50":false,"mine":false,"issn":["0167-8116","1873-8001"]},{"name":"International Journal of Sport Communication","abdc":"B","ft50":false,"mine":false,"issn":["1936-3915","1936-3907"]},{"name":"International Journal of Sports Management and Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1475-8962","1740-2808"]},{"name":"International Journal of Sports Marketing and Sponsorship","abdc":"B","ft50":false,"mine":false,"issn":["1464-6668","2515-7841"]},{"name":"International Journal of Work Organisation and Emotion","abdc":"B","ft50":false,"mine":false,"issn":["1740-8938","1740-8946"]},{"name":"International Marketing Review","abdc":"A","ft50":false,"mine":false,"issn":["0265-1335","1758-6763"]},{"name":"International Organization","abdc":"B","ft50":false,"mine":false,"issn":["0020-8183","1531-5088"]},{"name":"International Review on Public and Nonprofit Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1865-1984","1865-1992"]},{"name":"International Studies of Management & Organization","abdc":"B","ft50":false,"mine":false,"issn":["0020-8825","1558-0911"]},{"name":"Journal of Accounting & Organizational Change","abdc":"B","ft50":false,"mine":false,"issn":["1832-5912","1839-5473"]},{"name":"Journal of Advertising","abdc":"A","ft50":false,"mine":false,"issn":["0091-3367","1557-7805"]},{"name":"Journal of Advertising Research","abdc":"A","ft50":false,"mine":false,"issn":["0021-8499","1740-1909"]},{"name":"Journal of Agricultural and Resource Economics","abdc":"A","ft50":false,"mine":false,"issn":["1068-5502","2327-8285"]},{"name":"Journal of Agricultural Economics","abdc":"A","ft50":false,"mine":false,"issn":["0021-857X","1477-9552"]},{"name":"Journal of Business & Industrial Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0885-8624","2052-1189"]},{"name":"Journal of Business-to-Business Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1051-712X","1547-0628"]},{"name":"Journal of Consumer Affairs","abdc":"A","ft50":false,"mine":false,"issn":["0022-0078","1745-6606"]},{"name":"Journal of Consumer Behaviour","abdc":"A","ft50":false,"mine":false,"issn":["1472-0817","1479-1838"]},{"name":"Journal of Consumer Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0736-3761","2052-1200"]},{"name":"Journal of Cross-Cultural Psychology","abdc":"A","ft50":false,"mine":false,"issn":["0022-0221","1552-5422"]},{"name":"Journal of Cultural Economics","abdc":"A","ft50":false,"mine":false,"issn":["0885-2545","1573-6997"]},{"name":"Journal of Current Issues and Research in Advertising","abdc":"B","ft50":false,"mine":false,"issn":["1064-1734","2164-7313"]},{"name":"Journal of Destination Marketing & Management","abdc":"A","ft50":false,"mine":false,"issn":["2212-571X","2212-5752"]},{"name":"Journal of Economic Behavior and Organization","abdc":"A*","ft50":false,"mine":false,"issn":["0167-2681","1879-1751"]},{"name":"Journal of Electronic Commerce in Organizations","abdc":"B","ft50":false,"mine":false,"issn":["1539-2937","1539-2929"]},{"name":"Journal of Experimental Psychology: learning, memory, and cognition","abdc":"A","ft50":false,"mine":false,"issn":["0278-7393","1939-1285"]},{"name":"Journal of Fashion Marketing and Management","abdc":"B","ft50":false,"mine":false,"issn":["1361-2026","1758-7433"]},{"name":"Journal of Financial Services Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1363-0539","1479-1846"]},{"name":"Journal of Food Products Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1045-4446","1540-4102"]},{"name":"Journal of Global Fashion Marketing","abdc":"B","ft50":false,"mine":false,"issn":["2093-2685","2325-4483"]},{"name":"Journal of Global Marketing","abdc":"B","ft50":false,"mine":false,"issn":["0891-1762","1528-6975"]},{"name":"Journal of Global Scholars of Marketing Science","abdc":"B","ft50":false,"mine":false,"issn":["2163-9159","2163-9167"]},{"name":"Journal of Health Politics, Policy and Law","abdc":"A","ft50":false,"mine":false,"issn":["0361-6878","1527-1927"]},{"name":"Journal of Health, Organization and Management","abdc":"B","ft50":false,"mine":false,"issn":["1477-7266","1758-7247"]},{"name":"Journal of Historical Research in Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1755-750X","1755-7518"]},{"name":"Journal of Hospitality Marketing and Management","abdc":"A","ft50":false,"mine":false,"issn":["1936-8623","1936-8631"]},{"name":"Journal of Interactive Advertising","abdc":"B","ft50":false,"mine":false,"issn":["1525-2019"]},{"name":"Journal of Interactive Marketing","abdc":"A","ft50":false,"mine":false,"issn":["1094-9968","1520-6653"]},{"name":"Journal of International Consumer Marketing","abdc":"B","ft50":false,"mine":false,"issn":["0896-1530","1528-7068"]},{"name":"Journal of International Food and Agribusiness Marketing","abdc":"B","ft50":false,"mine":false,"issn":["0897-4438","1528-6983"]},{"name":"Journal of International Marketing","abdc":"A","ft50":false,"mine":false,"issn":["1069-031X","1547-7215"]},{"name":"Journal of Islamic Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1759-0833","1759-0841"]},{"name":"Journal of Law, Economics and Organization","abdc":"A","ft50":false,"mine":false,"issn":["8756-6222","1465-7341"]},{"name":"Journal of Macromarketing","abdc":"A","ft50":false,"mine":false,"issn":["0276-1467","1552-6534"]},{"name":"Journal of Management & Organization","abdc":"A","ft50":false,"mine":false,"issn":["1833-3672","1839-3527"]},{"name":"Journal of Marketing Communications","abdc":"B","ft50":false,"mine":false,"issn":["1352-7266","1466-4445"]},{"name":"Journal of Marketing Education","abdc":"B","ft50":false,"mine":false,"issn":["0273-4753","1552-6550"]},{"name":"Journal of Marketing for Higher Education","abdc":"B","ft50":false,"mine":false,"issn":["0884-1241","1540-7144"]},{"name":"Journal of Marketing Management","abdc":"A","ft50":false,"mine":false,"issn":["0267-257X","1472-1376"]},{"name":"Journal of Marketing Theory and Practice","abdc":"B","ft50":false,"mine":false,"issn":["1069-6679","1944-7175"]},{"name":"Journal of Nonprofit & Public Sector Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1049-5142","1540-6997"]},{"name":"Journal of Occupational and Organizational Psychology","abdc":"A*","ft50":false,"mine":false,"issn":["0963-1798","2044-8325"]},{"name":"Journal of Organizational and End User Computing","abdc":"B","ft50":false,"mine":false,"issn":["1546-2234","1546-5012"]},{"name":"Journal of Organizational Behavior","abdc":"A*","ft50":false,"mine":false,"issn":["0894-3796","1099-1379"]},{"name":"Journal of Organizational Behavior Management","abdc":"B","ft50":false,"mine":false,"issn":["0160-8061","1540-8604"]},{"name":"Journal of Organizational Change Management","abdc":"B","ft50":false,"mine":false,"issn":["0953-4814","1758-7816"]},{"name":"Journal of Organizational Computing and Electronic Commerce","abdc":"A","ft50":false,"mine":false,"issn":["1091-9392","1532-7744"]},{"name":"Journal of Organizational Effectiveness","abdc":"B","ft50":false,"mine":false,"issn":["2051-6614","2051-6622"]},{"name":"Journal of Political Economy","abdc":"A*","ft50":false,"mine":false,"issn":["0022-3808","1537-534X"]},{"name":"Journal of Political Economy: Macroeconomics","abdc":"A","ft50":false,"mine":false,"issn":["2832-9341","2832-935X"]},{"name":"Journal of Political Economy: Microeconomics","abdc":"A","ft50":false,"mine":false,"issn":["2832-9368","2832-9376"]},{"name":"Journal of Political Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1537-7857","1537-7865"]},{"name":"Journal of Professions and Organization","abdc":"A","ft50":false,"mine":false,"issn":["2051-8803","2051-8811"]},{"name":"Journal of Public Administration Research and Theory","abdc":"A","ft50":false,"mine":false,"issn":["1053-1858","1477-9803"]},{"name":"Journal of Public Policy and Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0743-9156","1547-7207"]},{"name":"Journal of Relationship Marketing","abdc":"B","ft50":false,"mine":false,"issn":["1533-2667","1533-2675"]},{"name":"Journal of Research in Interactive Marketing","abdc":"B","ft50":false,"mine":false,"issn":["2040-7122","2040-7130"]},{"name":"Journal of Research in Marketing and Entrepreneurship","abdc":"B","ft50":false,"mine":false,"issn":["1471-5201","1471-521X"]},{"name":"Journal of Retailing and Consumer Services","abdc":"A","ft50":false,"mine":false,"issn":["0969-6989","1873-1384"]},{"name":"Journal of Services Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0887-6045","2054-1651"]},{"name":"Journal of Social Marketing","abdc":"B","ft50":false,"mine":false,"issn":["2042-6763","2042-6771"]},{"name":"Journal of Strategic Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0965-254X","1466-4488"]},{"name":"Journal of Travel & Tourism Marketing","abdc":"A","ft50":false,"mine":false,"issn":["1054-8408","1540-7306"]},{"name":"Journal of Vacation Marketing","abdc":"A","ft50":false,"mine":false,"issn":["1356-7667","1479-1870"]},{"name":"Leadership & Organization Development Journal","abdc":"B","ft50":false,"mine":false,"issn":["0143-7739","1472-5347"]},{"name":"Management and Organization Review","abdc":"A","ft50":false,"mine":false,"issn":["1740-8776","1740-8784"]},{"name":"Marketing Intelligence & Planning","abdc":"A","ft50":false,"mine":false,"issn":["0263-4503","1758-8049"]},{"name":"Marketing Letters","abdc":"A","ft50":false,"mine":false,"issn":["0923-0645","1573-059X"]},{"name":"Marketing Theory","abdc":"A","ft50":false,"mine":false,"issn":["1470-5931","1741-301X"]},{"name":"New Political Economy","abdc":"A","ft50":false,"mine":false,"issn":["1356-3467","1469-9923"]},{"name":"Nonprofit Management and Leadership","abdc":"B","ft50":false,"mine":false,"issn":["1048-6682","1542-7854"]},{"name":"Organization & Environment","abdc":"A","ft50":false,"mine":false,"issn":["1086-0266","1552-7417"]},{"name":"Organization Management Journal","abdc":"B","ft50":false,"mine":false,"issn":["1541-6518"]},{"name":"Organizational Dynamics","abdc":"A","ft50":false,"mine":false,"issn":["0090-2616","1873-3530"]},{"name":"Organizational Psychology Review","abdc":"A","ft50":false,"mine":false,"issn":["2041-3866","2041-3874"]},{"name":"Organizational Research Methods","abdc":"A*","ft50":false,"mine":false,"issn":["1094-4281","1552-7425"]},{"name":"Policy and Politics: an international journal","abdc":"A","ft50":false,"mine":false,"issn":["0305-5736","1470-8442"]},{"name":"Political Science Quarterly","abdc":"A","ft50":false,"mine":false,"issn":["1538-165X"]},{"name":"Politics and Gender","abdc":"A","ft50":false,"mine":false,"issn":["1743-923X","1743-9248"]},{"name":"Psychology & Marketing","abdc":"A","ft50":false,"mine":false,"issn":["0742-6046","1520-6793"]},{"name":"Public Administration and Development","abdc":"A","ft50":false,"mine":false,"issn":["0271-2075","1099-162X"]},{"name":"Public Administration Quarterly","abdc":"A","ft50":false,"mine":false,"issn":["0734-9149","2327-4433"]},{"name":"Public Administration Review","abdc":"A","ft50":false,"mine":false,"issn":["0033-3352","1540-6210"]},{"name":"Public Administration: an international journal","abdc":"A","ft50":false,"mine":false,"issn":["0033-3298","1467-9299"]},{"name":"Public Relations Review","abdc":"A","ft50":false,"mine":false,"issn":["0363-8111","1873-4537"]},{"name":"Qualitative Research in Accounting and Management","abdc":"A","ft50":false,"mine":false,"issn":["1176-6093","1758-7654"]},{"name":"Quantitative Marketing and Economics","abdc":"A","ft50":false,"mine":false,"issn":["1570-7156","1573-711X"]},{"name":"Research in Organizational Behavior","abdc":"A","ft50":false,"mine":false,"issn":["0191-3085"]},{"name":"Research on Professional Responsibility and Ethics in Accounting","abdc":"B","ft50":false,"mine":false,"issn":["1574-0765"]},{"name":"Review of Industrial Organization","abdc":"A","ft50":false,"mine":false,"issn":["0889-938X","1573-7160"]},{"name":"Review of International Political Economy","abdc":"A","ft50":false,"mine":false,"issn":["0969-2290","1466-4526"]},{"name":"Science Communication","abdc":"A","ft50":false,"mine":false,"issn":["1075-5470","1552-8545"]},{"name":"Scottish Journal of Political Economy","abdc":"A","ft50":false,"mine":false,"issn":["0036-9292","1467-9485"]},{"name":"Services Marketing Quarterly","abdc":"B","ft50":false,"mine":false,"issn":["1533-2969","1533-2977"]},{"name":"Social Marketing Quarterly","abdc":"B","ft50":false,"mine":false,"issn":["1524-5004","1539-4093"]},{"name":"Sociological Methodology","abdc":"A","ft50":false,"mine":false,"issn":["0081-1750","1467-9531"]},{"name":"Sociological Theory","abdc":"A","ft50":false,"mine":false,"issn":["0735-2751","1467-9558"]},{"name":"Sociology","abdc":"A*","ft50":false,"mine":false,"issn":["0038-0385","1469-8684"]},{"name":"Sociology of Sport Journal","abdc":"A","ft50":false,"mine":false,"issn":["0741-1235","1543-2785"]},{"name":"Spanish Journal of Marketing – ESIC","abdc":"B","ft50":false,"mine":false,"issn":["2444-9709"]},{"name":"Sport Marketing Quarterly","abdc":"B","ft50":false,"mine":false,"issn":["1061-6934","1557-2528"]},{"name":"Strategic Organization","abdc":"A","ft50":false,"mine":false,"issn":["1476-1270","1741-315X"]},{"name":"The Australian Journal of Agricultural and Resource Economics","abdc":"A","ft50":false,"mine":false,"issn":["1364-985X","1467-8489"]},{"name":"Voluntas: International Journal of Voluntary and Non-Profit Organizations","abdc":"B","ft50":false,"mine":false,"issn":["0957-8765","1573-7888"]},{"name":"Work & Stress: An international Journal of Work, Health and Organisations","abdc":"A","ft50":false,"mine":false,"issn":["0267-8373","1464-5335"]},{"name":"Work, Employment and Society","abdc":"A","ft50":false,"mine":false,"issn":["0950-0170","1469-8722"]},{"name":"World Politics","abdc":"A","ft50":false,"mine":false,"issn":["0043-8871","1086-3338"]},{"name":"Written Communication","abdc":"B","ft50":false,"mine":false,"issn":["0741-0883","1552-8472"]}];
// ==== end watchlist.js ====

// ==== insights.js (copied from the app by tools/make_gscript.py; edit it there) ====
// Daily research insights: rank recently published papers (Crossref) against the user's own papers and suggest a next study.
// Used by the Google Sheet script (and testable in node), so plain ES5 with no browser APIs.
//
// rdCrossrefUrl(issn, fromDate, mailto)        -> Crossref API URL for that journal's recent articles
// rdCrossrefItems(json, journal)               -> [{doi, title, authors, journal, abdc, ft50, mine, published, abstract}]
// rdRankInsights(items, papers, seenDois, n)   -> top n items with {score, paper (best-matching paper key), why, tip}
//   papers: [{key, title}]

var RD_STOP_I = ("the of and for in on a an to with from by into as at is are was were be this that these those its their our we " +
  "how what why when who whose which not no new study studies paper article research analysis approach role case evidence " +
  "using use toward towards between through within among across beyond after over under about via based theory theoretical " +
  "empirical review perspective perspectives implications insights understanding exploring examining effects effect impact " +
  "do does can may might more less than also both one two three first").split(" ");
var RD_STOP_SET = {};
RD_STOP_I.forEach(function (w) { RD_STOP_SET[w] = 1; });

// Extra vocabulary per theme, so a paper about "voice" or "mourning" can still meet a "silence" or "grief" paper.
var RD_THEMES = [
  ["silence", "silencing", "voice", "speaking", "unsaid", "absence"], ["death", "dying", "mortality", "finitude", "mourning", "grief", "grieving"],
  ["blanchot", "derrida", "heidegger", "levinas", "foucault", "deconstruction", "phenomenology", "hauntology", "spectral"],
  ["discourse", "discursive", "critical discourse", "rhetoric", "narrative", "framing", "language"],
  ["generative", "artificial intelligence", "chatgpt", "algorithm", "algorithmic", "automation", "large language"],
  ["securitization", "securitisation", "security", "threat", "surveillance"], ["protest", "activism", "movement", "resistance", "dissent"],
  ["leadership", "leader", "authority", "power", "sovereignty", "violence"], ["ethics", "ethical", "moral", "virtue", "responsibility"],
  ["knowledge hiding", "knowledge sharing", "tacit knowledge", "knowledge"], ["memory", "remembrance", "commemoration", "temporality", "time"],
  ["advertising", "marketing", "brand", "consumer", "virtue signalling", "csr"], ["apology", "apologies", "crisis communication", "accountability"],
  ["kinship", "family", "belonging", "identity", "organizational culture"], ["fact-checking", "misinformation", "disinformation", "attribution", "news"],
  ["assessment", "testing", "multilingual", "linguistic"], ["hedging", "uncertainty", "epistemic"], ["india", "indian", "global south", "postcolonial"]
];

function rdText(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(); }
function rdTokens(s) {
  var t = " " + rdText(s).toLowerCase().replace(/[‘’'`]/g, "").replace(/[^a-z0-9\- ]+/g, " ") + " ";
  return t.split(/\s+/).filter(function (w) { return w.length > 2 && !RD_STOP_SET[w]; })
    .map(function (w) { return w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"); });
}

function rdCrossrefUrl(issn, fromDate, mailto) {
  return "https://api.crossref.org/journals/" + issn + "/works?filter=from-pub-date:" + fromDate + ",type:journal-article" +
    "&rows=60&sort=published&order=desc&select=DOI,title,author,published,container-title,abstract" + (mailto ? "&mailto=" + encodeURIComponent(mailto) : "");
}

function rdCrossrefItems(json, journal) {
  var items = (json && json.message && json.message.items) || [];
  return items.filter(function (w) { return w.DOI && w.title && w.title.length; }).map(function (w) {
    var d = (w.published && w.published["date-parts"] && w.published["date-parts"][0]) || [];
    var pad = function (x) { return x < 10 ? "0" + x : "" + x; };
    return {
      doi: String(w.DOI).toLowerCase(), title: rdText(w.title[0]),
      authors: (w.author || []).slice(0, 4).map(function (a) { return [a.family, a.given ? a.given.charAt(0) + "." : ""].filter(Boolean).join(", "); }).join("; ") + ((w.author || []).length > 4 ? " et al." : ""),
      journal: journal.name, abdc: journal.abdc || "", ft50: !!journal.ft50, mine: !!journal.mine,
      published: d.length ? d[0] + "-" + pad(d[1] || 1) + "-" + pad(d[2] || 1) : "", abstract: rdText(w.abstract).replace(/^abstract\s*/i, "")
    };
  });
}

/** Ranks items: rare words shared with one of the user's papers, in the title (x2) and abstract, plus theme links. */
function rdRankInsights(items, papers, seenDois, n) {
  n = n || 5;
  seenDois = seenDois || {};
  var df = {}, N = items.length || 1;
  items.forEach(function (it) { var s = {}; rdTokens(it.title + " " + it.abstract).forEach(function (w) { if (!s[w]) { s[w] = 1; df[w] = (df[w] || 0) + 1; } }); });
  var idf = function (w) { return Math.log((N + 1) / (1 + (df[w] || 0))); };
  var themeOf = {};
  RD_THEMES.forEach(function (th, i) { th.forEach(function (w) { rdTokens(w).forEach(function (t) { themeOf[t] = i; }); }); });
  var profiles = papers.map(function (p) {
    var words = {}, themes = {};
    rdTokens(p.key + " " + p.title).forEach(function (w) { words[w] = 1; if (themeOf[w] !== undefined) themes[themeOf[w]] = 1; });
    return { p: p, words: words, themes: themes };
  });
  var scored = [];
  items.forEach(function (it) {
    if (seenDois[it.doi] || !it.title || /^(editorial|erratum|corrigendum|correction|retraction|book review|reviewer|index|issue information|front matter)/i.test(it.title)) return;
    var tw = rdTokens(it.title), aw = rdTokens(it.abstract), best = null;
    var tset = {}, aset = {};
    tw.forEach(function (w) { tset[w] = 1; }); aw.forEach(function (w) { aset[w] = 1; });
    profiles.forEach(function (pr) {
      var sc = 0, hits = [], th = {};
      Object.keys(pr.words).forEach(function (w) {
        if (tset[w]) { sc += 2 * idf(w); hits.push(w); } else if (aset[w]) { sc += 0.8 * idf(w); hits.push(w); }
      });
      Object.keys(tset).concat(Object.keys(aset)).forEach(function (w) { var t = themeOf[w]; if (t !== undefined && pr.themes[t] && !th[t]) { th[t] = 1; sc += 2.5; } });
      sc = sc / Math.sqrt(Math.max(4, tw.length));
      if (!best || sc > best.score) best = { score: sc, pr: pr, hits: hits };
    });
    if (!best || best.score <= 0) return;
    var boost = (it.abdc === "A*" || it.ft50 ? 0.6 : it.abdc === "A" ? 0.35 : 0) + (it.mine ? 0.3 : 0) + (it.abstract ? 0.2 : 0);
    scored.push({ it: it, score: best.score + boost, paper: best.pr.p, hits: best.hits });
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  var out = [], perPaper = {}, perJournal = {};
  scored.forEach(function (x) {
    if (out.length >= n) return;
    var pk = x.paper.key;
    if ((perPaper[pk] || 0) >= 2 || (perJournal[x.it.journal] || 0) >= 1) return;
    perPaper[pk] = (perPaper[pk] || 0) + 1; perJournal[x.it.journal] = 1;
    out.push(rdDescribe(x));
  });
  scored.forEach(function (x) { if (out.length < n && out.every(function (o) { return o.doi !== x.it.doi; })) out.push(rdDescribe(x)); });
  return out;
}

function rdDescribe(x) {
  var it = x.it, p = x.paper;
  var shared = x.hits.filter(function (w, i, a) { return a.indexOf(w) === i; }).slice(0, 4);
  var o = {};
  Object.keys(it).forEach(function (k) { o[k] = it[k]; });
  o.score = Math.round(x.score * 100) / 100;
  o.paper = p.key;
  o.why = "Close to your paper “" + p.key + "”" + (shared.length ? " (shared focus: " + shared.join(", ") + ")" : " (allied theme)") + ".";
  o.tip = rdTip(it, p, shared);
  return o;
}

/** A structured next-study prompt (the optional Claude-written ideas replace this when an API key is set). */
function rdTip(it, p, shared) {
  var words = function (s) { return rdText(s).replace(/[‘’“”"]/g, "").split(/[^A-Za-z\-]+/).filter(function (w) { return w.length > 4 && !RD_STOP_SET[w.toLowerCase()]; }); };
  var theirs = rdTokens(it.title).join(" ");
  var lens = words(p.title || p.key).filter(function (w) { return theirs.indexOf(rdTokens(w)[0] || "~") < 0; })
    .filter(function (w, i, a) { return a.indexOf(w) === i; }).slice(0, 3).join(", ");
  var topic = rdText(it.title).split(/[:?—–]/)[0].trim();
  var all = ((p.title || "") + " " + p.key).toLowerCase();
  var method = /review|bibliometric|systematic/.test(all) ? "a systematic or bibliometric review" :
    /discourse|cda|language|rhetoric|speech/.test(all) ? "a critical discourse analysis" :
    /blanchot|derrida|heidegger|levinas|foucault/.test(all) ? "a conceptual paper" : "a qualitative, interpretive study";
  var context = /india|indian|malawi/.test(all) ? "Indian / Global South settings" : "an under-studied setting (e.g. India or the Global South)";
  return "Next-study idea: " + method.charAt(0).toUpperCase() + method.slice(1) + " that takes up “" + topic + "” through the lens of your paper “" +
    p.key + "”" + (lens ? " (" + lens + ")" : "") + " in " + context + ", stating what their account leaves unexplained.";
}
// ==== end insights.js ====

// ==== emailparse.js (copied from the app by tools/make_gscript.py; edit it there) ====
// Reads a journal email: what happened, desk or reviewed, how many reviews, manuscript ID, and which submission it is.
// Shared by the app (paste / share an email) and the Google Sheet script (Gmail import), so plain ES5 with no browser APIs.
//
// rdParseEmail({subject, from, body, date}, subs) -> {
//   event: "submitted" | "resubmitted" | "under review" | "Rejected" | "Revision requested" | "Accepted" | "Returned by office" | "Withdrawn" | "",
//   status, dtype ("Desk rejection" | "Rejected after review" | ""), reviews, msid, sub, score, confident, reasons[], skip }
//   subs: [{id, paper, title, titleUsed, journal, status, submitted, msid}]  (paper = short name, title = full title)
//
// Built to err on the side of "please confirm": a status only changes on its own when the email clearly names the paper.

var RD_MSID = /\b[A-Z][A-Z0-9&]{1,14}(?:-[A-Z]{1,2})?(?:-\d{2,6}){2,3}(?:\.R\d+)?\b/;
var RD_ORDER = { "Planned": 0, "Under review": 1, "Returned by office": 2, "Revision requested": 2, "Revision resubmitted": 3,
  "Rejected": 4, "Accepted": 4, "Withdrawn": 4 };
var RD_DECISIONS = { "Rejected": 1, "Accepted": 1, "Revision requested": 1, "Returned by office": 1, "Withdrawn": 1 };

function rdEmailNorm(s) {
  return " " + String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[‘’'`"“”]/g, "").replace(/[^a-z0-9]+/g, " ").trim() + " ";
}
function rdEmailWords(s) {
  var stop = { the: 1, and: 1, "for": 1, from: 1, with: 1, into: 1, that: 1, this: 1, their: 1, what: 1, whose: 1, when: 1,
    toward: 1, towards: 1, between: 1, through: 1, within: 1, journal: 1, paper: 1, study: 1, analysis: 1, review: 1,
    organizational: 1, organization: 1, communication: 1, management: 1, social: 1, critical: 1, theory: 1, ethics: 1 };
  return rdEmailNorm(s).split(" ").filter(function (w) { return w.length > 3 && !stop[w]; });
}
/** Share of the paper's distinctive title words found in the text (common field words don't count). */
function rdEmailOverlap(a, text) {
  var A = rdEmailWords(a).filter(function (w, i, arr) { return arr.indexOf(w) === i; });
  if (A.length < 2) return 0;
  var T = rdEmailNorm(text), hit = 0;
  A.forEach(function (w) { if (T.indexOf(" " + w + " ") >= 0) hit++; });
  return hit / A.length;
}
function rdBaseId(id) { return String(id || "").toUpperCase().replace(/\.R\d+$/, ""); }

/** The email's own text: drops quoted replies (keeps a forwarded email, which is what you want read). */
function rdEmailOwnText(body) {
  var t = String(body || "").replace(/\r/g, "");
  var cut = t.search(/^\s*(On .{5,160}wrote:|-{2,}\s*Original Message\s*-{2,}|>{1,}\s)/m);
  return cut > 40 ? t.slice(0, cut) : t;
}

/** Sentences that state something, not boilerplate rules ("papers that ... may be rejected", "if you decline ..."). */
function rdEmailFactual(text) {
  return String(text || "").replace(/\n\s*\n/g, ". ").replace(/\s+/g, " ").replace(/([.!?])\s+/g, "$1\n").split("\n").filter(function (s) {
    return !/\b(if|may|might|could|should|unless|whether|policy|policies|guidelines?|instructions|percent|%|typically|usually|generally|please note|papers that|manuscripts that|submissions that|articles that|those that|any (paper|manuscript|submission)s?)\b/i.test(s);
  }).join(" ").toLowerCase();
}

/** What the email says happened. Strong decision phrases only, in factual sentences; acknowledgements otherwise. */
function rdEmailEvent(text, subject) {
  var raw = String(text || "").toLowerCase().replace(/\s+/g, " "), x = rdEmailFactual(text), subj = String(subject || "").toLowerCase();
  if (/(pleased|delighted|happy) to (inform you that .{0,140})?accept (your|the|this)|(has|have) been accepted for publication|accepted (it )?for publication in|decision (is|was|:)\s*(to )?accept\b|final acceptance of your/.test(x)) return "Accepted";
  if (/(decision|recommendation)\s*(is|was|:)\s*(a\s*)?(major|minor) revision|(major|minor) revisions? (are|is) (required|needed|necessary|requested)|reviewers? (recommend|have recommended|suggest) (major|minor) revision|revise and resubmit|invit\w* you to (revise|resubmit|submit a revised)|(would|will) be (happy|pleased|glad) to (see|consider|receive) a revised|your manuscript (requires|needs) (major|minor) revision/.test(x)) return "Revision requested";
  if (/regret to (inform|advise|tell|let you know)|unable to (accept|publish|offer|consider|proceed with) (your|this|the|it\b)|not (be )?able to (accept|publish|offer|consider|proceed with) (your|this|the|it\b)|(did|does) not pass (the )?(editorial|initial) (screening|assessment|check)|decided (not to (publish|accept|proceed|pursue|send|consider|take)|to reject|against (publication|publishing|accepting))|(must|have to|will have to|am obliged to|regretfully) decline (your|this|the)|declin(e|ed) (your|this|the) (manuscript|paper|submission|article) for publication|reject(ed)? (your|this|the) (manuscript|paper|submission|article)|your (manuscript|paper|submission|article) (has been|was|is) (rejected|declined|not accepted)|decision\s*(on your manuscript\s*)?(is|was|:)\s*(to\s*)?reject|cannot (accept|publish|consider) (your|this|the)|will not be (considering|considered|published|proceeding) (it |your |this |the )?(further|for publication|for review)|not (be )?(proceeding|moving forward|taking (it|your (manuscript|paper)) forward) with (your|this|the)/.test(x)) return "Rejected";
  if (/(manuscript|submission|paper) (has been|was|is being) (unsubmitted|returned to you|sent back to you)|unsubmitted (your|the) (manuscript|submission)|returned (to you )?for (correction|changes|revision of (format|formatting))|please (address|correct) the following (issues|points|items) (and|before) resubmit/.test(x) || /unsubmitted|returned to author|technical check (failed|result)/.test(subj)) return "Returned by office";
  if (/(your|the) (manuscript|submission) (has been|was) withdrawn|confirm(ing)? (the )?withdrawal of (your|the) (manuscript|submission)/.test(x)) return "Withdrawn";
  if (/revised (manuscript|version|paper|submission)|revision (has been|was) (successfully )?(submitted|received)/.test(raw) && /(successfully )?(submitted|received)|thank you for (submitting|your)/.test(raw)) return "resubmitted";
  if (/(has|have) been (sent|send) (out )?(for|to) (external |peer )?review|(sent|send) (it |your manuscript |the manuscript )?out for (external |peer )?review|reviewers? (have been|has been) (invited|assigned|contacted|selected) (for|to)|now under (peer )?review/.test(x)) return "under review";
  if (/successfully submitted|been (successfully )?(submitted|received)|received your (manuscript|submission|paper)|thank you for (submitting|your submission)|acknowledg\w+ (the )?receipt|submission (has been )?received|confirm(ing|s)? (the )?(receipt|submission)/.test(raw) ||
      /(submission|manuscript).{0,40}(received|submitted|confirmation|acknowledg)|acknowledg/.test(subj)) return "submitted";
  return "";
}

/** Desk rejection vs rejection after review, and how many reviewer reports are in the email. */
function rdEmailReviews(text) {
  var t = String(text || ""), x = rdEmailFactual(t), n = 0, m, re = /\b(?:reviewer|referee)\s*(?:#|no\.?|number)?\s*:?\s*(\d{1,2})\b/gi;
  while ((m = re.exec(t))) if (+m[1] < 10) n = Math.max(n, +m[1]);
  if (!n && /(reviewer|referee)s?'?\s*(comments|reports?)\s*(to (the )?author|:)/i.test(t)) n = 1;
  var desk = /without (sending it |being sent )?(out )?(for )?(external |peer )?review|not (be )?sent (it )?(out )?for (external |peer )?review|decided not to send|not send (it|your (manuscript|paper)) (out )?(for|to) (external |peer )?review|desk[- ]?reject|outside (the )?(aims and )?scope of|not a (good )?fit (for|with) (the|this|our)|does not fit (the|within)/.test(x);
  return { reviews: n, desk: desk && !n, reviewed: n > 0 || /reviewers? (have|has) (now )?(commented|reviewed|completed|returned)|comments from the reviewers|reviewers'? (comments|reports) (are|is) (below|attached|included)/.test(x) };
}

/** Journal names that occur in the text; a name inside a longer matching name (Organization ⊂ Organization Theory) is dropped. */
function rdJournalHits(text, journals) {
  var hits = journals.filter(function (j) { return j.length > 5 && text.indexOf(j) >= 0; });
  return hits.filter(function (j) { return !hits.some(function (k) { return k !== j && k.indexOf(j) >= 0; }); });
}

function rdParseEmail(mail, subs) {
  var subject = mail.subject || "", from = mail.from || "", body = rdEmailOwnText(mail.body);
  // emails about reviewing other people's work are not about your submissions
  var skip = /invitation to review|invite you to review|review (the|a|this) manuscript|thank you for (your )?review|reviewer (invitation|reminder|report|assignment)|as a reviewer|review (is|was) (overdue|due)|your review (of|for)/i.test(subject + "\n" + body.slice(0, 1200));
  var event = skip ? "" : rdEmailEvent(subject + "\n" + body, subject);
  var idm = (subject.match(RD_MSID) || body.match(RD_MSID) || [""])[0];
  var rv = rdEmailReviews(body);
  var top = rdEmailNorm(subject + " " + from), head = rdEmailNorm(body.slice(0, 2500));
  var names = {};
  (subs || []).forEach(function (s) { names[rdEmailNorm(String(s.journal || "").replace(/-A$/, "").replace(/\(.*?\)/g, ""))] = 1; });
  var nameList = Object.keys(names), topHits = rdJournalHits(top, nameList), headHits = rdJournalHits(head, nameList);
  var titleText = subject + "\n" + body.slice(0, 4000);
  var best = null, bestScore = 0, reasons = [], bestOv = 0, scores = [];
  (subs || []).forEach(function (s) {
    var sc = 0, why = [];
    var idMatch = idm && s.msid && rdBaseId(s.msid) === rdBaseId(idm);
    if (idMatch) { sc += 100; why.push("manuscript ID"); }
    var j = rdEmailNorm(String(s.journal || "").replace(/-A$/, "").replace(/\(.*?\)/g, ""));
    if (topHits.indexOf(j) >= 0) { sc += 30; why.push("journal"); } else if (headHits.indexOf(j) >= 0) { sc += 12; why.push("journal in text"); }
    var ov = Math.max(rdEmailOverlap(s.title, titleText), rdEmailOverlap(s.titleUsed, titleText), rdEmailOverlap(s.paper, titleText));
    if (ov >= 0.5) { sc += 50 * ov; why.push("title " + Math.round(ov * 100) + "%"); }
    var open = s.status === "Under review" || s.status === "Revision requested" || s.status === "Returned by office";
    // the attempt from the email's time: submitted on/before the email, the closer the better
    if (mail.date && s.submitted) {
      var gap = (Date.parse(mail.date) - Date.parse(s.submitted)) / 864e5;
      sc += gap < -2 ? -25 : 6 - Math.min(gap, 600) / 120;
    }
    if (event === "submitted" && s.status === "Planned") sc += 6;
    else if (event === "resubmitted" && (s.status === "Revision requested" || s.status === "Returned by office")) sc += 8;
    else if ((RD_DECISIONS[event] || event === "under review") && open) sc += 6;
    scores.push({ s: s, sc: sc });
    if (sc > bestScore) { bestScore = sc; best = s; reasons = why; bestOv = ov; }
  });
  // the closest rival is the best-scoring row of a different paper (another attempt of the same paper is not a rival)
  var second = 0;
  scores.forEach(function (x) { if (best && x.s.paper !== best.paper && x.sc > second) second = x.sc; });
  var hasId = reasons.indexOf("manuscript ID") >= 0, hasJournal = reasons.indexOf("journal") >= 0 || reasons.indexOf("journal in text") >= 0;
  // A decision changes a row on its own only with the manuscript ID, or the journal plus most of the paper's title, and no close rival.
  var confident = !!best && !!event && !skip && (hasId ||
    (hasJournal && bestOv >= (RD_DECISIONS[event] ? 0.6 : 0.5) && bestScore - second >= 15));
  var status = { "submitted": "Under review", "resubmitted": "Under review", "under review": "Under review" }[event] || event;
  var dtype = "";
  if (event === "Rejected") dtype = rv.desk ? "Desk rejection" : rv.reviewed ? "Rejected after review" : "";
  return { event: event, status: status, dtype: dtype, reviews: rv.reviews, msid: idm, sub: bestScore >= 30 ? best : null,
           score: bestScore, confident: confident, reasons: reasons, skip: skip };
}
// ==== end emailparse.js ====

// ==== suggest.js (copied from the app by tools/make_gscript.py; edit it there) ====
// Next-journal recommendations from the ABDC list. Shared by the app and the Google Sheet script
// (google-sheets/RD-SK-sync.gs embeds a copy), so plain ES5 with no browser APIs.
//
// rdSuggest(paper, subs, abdc, n) -> [{title, grade, field, publisher, score, why}]
//   paper: {key, title}; subs: that paper's submissions [{journal, status, submitted, decided}];
//   abdc: [[title, grade, FoR code, publisher], ...]
// A journal scores for: sharing an ABDC field with journals already chosen for the paper, wording that matches the
// paper's title and those journals (rarer words count more), and a tier close to the journal that last rejected it.
var RD_TIERS = { "A*": 4, "A": 3, "B": 2, "C": 1 };
var RD_STOP = { the: 1, of: 1, and: 1, "for": 1, "in": 1, on: 1, a: 1, an: 1, to: 1, journal: 1, international: 1, review: 1,
  research: 1, studies: 1, quarterly: 1, annals: 1, letters: 1, proceedings: 1, transactions: 1, s: 1, at: 1, by: 1, with: 1,
  from: 1, its: 1, their: 1, our: 1, what: 1, how: 1, who: 1, whose: 1, is: 1, are: 1, not: 1, "new": 1, one: 1 };
var rdIdfCache = null;

function rdNorm(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, " ").replace(/-a$/, "")
    .replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function rdWords(s) {
  return rdNorm(s).split(" ").filter(function (w) { return w.length > 2 && !RD_STOP[w]; })
    .map(function (w) { return w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"); });
}
function rdIdf(abdc) {
  if (rdIdfCache && rdIdfCache.n === abdc.length) return rdIdfCache;
  var df = {};
  abdc.forEach(function (j) { var seen = {}; rdWords(j[0]).forEach(function (w) { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } }); });
  rdIdfCache = { n: abdc.length, df: df, byName: {} };
  abdc.forEach(function (j) { rdIdfCache.byName[rdNorm(j[0])] = j; });
  return rdIdfCache;
}
function rdLookup(abdc, journal) { return rdIdf(abdc).byName[rdNorm(journal)] || null; }

function rdSuggest(paper, subs, abdc, n) {
  n = n || 8;
  var idx = rdIdf(abdc), N = abdc.length;
  var w = function (word) { return Math.log(N / (1 + (idx.df[word] || 0))); };
  var used = {}, fields = {}, nFields = 0, bag = {};
  var add = function (word, k) { bag[word] = (bag[word] || 0) + k; };
  rdWords((paper.title || "") + " " + (paper.key || "")).forEach(function (x) { add(x, 2); });
  var last = null;
  subs.forEach(function (s) {
    used[rdNorm(s.journal)] = 1;
    var j = rdLookup(abdc, s.journal);
    if (j) { fields[j[2]] = (fields[j[2]] || 0) + 1; nFields++; rdWords(j[0]).forEach(function (x) { add(x, 1); }); }
    else rdWords(s.journal).forEach(function (x) { add(x, 1); });
    if (j && s.status !== "Planned" && (!last || (s.submitted || "") >= (last.s.submitted || ""))) last = { s: s, j: j };
  });
  // tier to aim for: the journal it was last sent to, else the best one it was aimed at
  var target = last ? RD_TIERS[last.j[1]] : 0;
  if (!target) subs.forEach(function (s) { var j = rdLookup(abdc, s.journal); if (j) target = Math.max(target, RD_TIERS[j[1]]); });
  if (!target) target = 3;
  var out = [], pass = function (anyField) { abdc.forEach(function (j) {
    if (used[rdNorm(j[0])] || /^annual review/i.test(j[0])) return;           // invite-only review series
    var f = nFields ? (fields[j[2]] || 0) / nFields : 0;
    if (nFields && !f && !anyField) return;                                     // stay in the paper's ABDC fields
    if (anyField && f) return;                                                  // (already scored in the first pass)
    var words = rdWords(j[0]), topic = 0, hits = [], seen = {};
    words.forEach(function (x) { if (bag[x] && !seen[x]) { seen[x] = 1; topic += Math.min(bag[x], 3) * w(x); hits.push(x); } });
    if (!topic || (anyField && hits.length < 2)) return;                        // outside its fields: need a clear topic match
    topic = topic / Math.sqrt(Math.max(words.length, 1));                       // long titles don't win on word count
    var gap = RD_TIERS[j[1]] - target;
    var tier = gap === 0 ? 3 : gap === -1 ? 2.2 : gap === 1 ? 1.8 : gap === -2 ? 0.6 : 0;
    var score = topic + f * 4 + tier * 3 - (anyField ? 6 : 0);
    out.push({ title: j[0], grade: j[1], field: j[2], publisher: j[3], score: score,
      why: "matches “" + hits.slice(0, 3).join(", ") + "”" + (anyField ? " · related field" : "") });
  }); };
  pass(false);
  if (out.length < n && nFields) pass(true);                                    // few in-field matches: look wider
  out.sort(function (a, b) { return b.score - a.score; });
  return out.slice(0, n);
}
// ==== end suggest.js ====
