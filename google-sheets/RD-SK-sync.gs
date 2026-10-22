/**
 * RD SK ↔ Google Sheets sync (two-way) + suggested next journals.
 *
 * Setup (once): open your RD SK master Google Sheet → Extensions → Apps Script → replace everything with this file →
 * Save → Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone → Deploy → Authorize →
 * copy the Web app URL into RD SK (More → Google Sheets sync).
 *
 * Columns are found by their header names, so you can reorder or add columns. The app only changes the columns you
 * type in (and Manuscript ID, Status on journal site, Status checked, App ID, Updated, Suggested next journals).
 * Formula columns, the Dashboard and the ABDC list are left alone.
 */

var PAPER_COLS = { key: /^paper/i, title: /^(current |full )?title$/i, authors: /^authors?$/i, type: /^type$/i,
  override: /^override/i, notes: /^notes?$/i, suggest: /^suggested next/i, id: /^app id$/i, updated: /^updated$/i };
var SUB_COLS = { paper: /^paper$/i, journal: /^journal$/i, abdc: /^abdc/i, rating: /rating|index/i, status: /^status$/i,
  submitted: /^(date submitted|date of submission)/i, decided: /^date of decision/i, notes: /^notes?$/i,
  titleUsed: /^title used/i, msid: /^manuscript id/i, live: /^status on journal/i, liveAt: /^status checked/i,
  id: /^app id$/i, updated: /^updated$/i };
var JOURNAL_COLS = { journal: /^journal$/i, abdc: /^abdc 2025/i, link: /^login link/i, email: /email/i };
var ADD_PAPER = { suggest: 'Suggested next journals', id: 'App ID', updated: 'Updated' };
var ADD_SUB = { msid: 'Manuscript ID', live: 'Status on journal site', liveAt: 'Status checked', id: 'App ID', updated: 'Updated' };
var APP_SHEET = 'RD SK app', ABDC_SHEET = 'ABDC list';

function doGet() { return out(handle({})); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return out(handle(body));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RD SK').addItem('Refresh suggested journals', 'refreshSuggestions').addToUi();
}

function refreshSuggestions() {
  var r = handle({});
  SpreadsheetApp.getActive().toast(r.ok ? 'Suggested next journals updated.' : r.error, 'RD SK');
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
    var pb = block(ps, P), sb = block(subs, S);
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
      put(row, S, 'live', s.live || ''); put(row, S, 'liveAt', date(s.liveAt));
      put(row, S, 'id', s.id); put(row, S, 'updated', new Date(s.mod || Date.now()));
    });
    (body.deleted || []).forEach(function (id) {
      var i = find(pb, P, id, null);
      if (i >= 0) ['key', 'title', 'authors', 'type', 'override', 'notes', 'suggest', 'id', 'updated'].forEach(function (f) { put(pb.v[i], P, f, ''); });
      i = find(sb, S, id, null);
      if (i >= 0) ['paper', 'journal', 'rating', 'status', 'submitted', 'decided', 'notes', 'titleUsed', 'msid', 'live', 'liveAt', 'id', 'updated']
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

    // 4. Per-journal data (Journals tab) and app settings.
    var app = appData(ss, body.app);

    // 5. Send everything back.
    return {
      ok: true, now: Date.now(), sheet: ss.getName(), app: app,
      papers: pb.v.filter(function (r) { return str(g(r, P, 'key')); }).map(function (r) {
        return { id: str(g(r, P, 'id')), key: str(g(r, P, 'key')), title: str(g(r, P, 'title')), authors: str(g(r, P, 'authors')),
                 type: str(g(r, P, 'type')), override: str(g(r, P, 'override')), notes: str(g(r, P, 'notes')) };
      }),
      subs: sb.v.filter(isSub).map(function (r) {
        return { id: str(g(r, S, 'id')), paper: str(g(r, S, 'paper')), journal: str(g(r, S, 'journal')), rating: str(g(r, S, 'rating')),
                 abdc: str(g(r, S, 'abdc')), status: str(g(r, S, 'status')), submitted: day(g(r, S, 'submitted'), tz),
                 decided: day(g(r, S, 'decided'), tz), notes: str(g(r, S, 'notes')), titleUsed: str(g(r, S, 'titleUsed')),
                 msid: str(g(r, S, 'msid')), live: str(g(r, S, 'live')), liveAt: day(g(r, S, 'liveAt'), tz) };
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
    b.f[0].forEach(function (f, j) { if (f) sh.getRange(2, j + 1).copyTo(sh.getRange(first, j + 1, b.added, 1)); });
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
