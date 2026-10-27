// RD SK ↔ your Google Sheet, straight from the phone (Sheets API v4 + Drive API v3, signed in with Google,
// permission "drive.file" = only files this app created). Does what the old web-app script's handle() did:
// newest edit wins (Updated column vs the phone's change time), IDs for hand-typed rows, suggested journals,
// Journals tab links/emails, app settings, journal emails waiting in the app, decisions, insights and the AI log.
//
// rdgCreate(api, upload, title)           -> {id, name}: a new sheet made from the built-in master template
// rdgFind(api)                            -> [{id, name, modifiedTime}] sheets RD SK created in this Drive
// rdgSync(api, id, body, opts)            -> the same reply the web app gave ({ok, papers, subs, app, pending, insights, ai, sheet})
// rdgReplace(api, id, papers, subs)       -> writes the phone's papers and submissions into an empty sheet (first move)
//   api(method, path, body) -> parsed JSON (throws on errors); path is relative to https://sheets.googleapis.com/v4/
//   or a full https URL. opts: {abdc: RD_ABDC list, suggest: rdSuggest, now: Date.now()}

var RDG_PAPER = { key: /^paper/i, title: /^(current |full )?title$/i, authors: /^authors?$/i, type: /^type$/i,
  override: /^override/i, notes: /^notes?$/i, suggest: /^suggested next/i, id: /^app id$/i, updated: /^updated$/i, approach: /^approach$/i };
var RDG_SUB = { paper: /^paper$/i, journal: /^journal$/i, abdc: /^abdc/i, rating: /rating|index/i, status: /^status$/i,
  submitted: /^(date submitted|date of submission)/i, decided: /^date of decision/i, notes: /^notes?$/i, titleUsed: /^title used/i,
  msid: /^manuscript id/i, live: /^status on journal/i, liveAt: /^status checked/i, dtype: /^decision type/i, id: /^app id$/i, updated: /^updated$/i };
var RDG_JOURNAL = { journal: /^journal$/i, abdc: /^abdc 2025/i, link: /^login link/i, email: /email/i };
var RDG_ADD_PAPER = { suggest: "Suggested next journals", id: "App ID", updated: "Updated", approach: "Approach" };
var RDG_ADD_SUB = { msid: "Manuscript ID", live: "Status on journal site", liveAt: "Status checked", dtype: "Decision type", id: "App ID", updated: "Updated" };
var RDG_DATES = { submitted: 1, decided: 1, liveAt: 1 };
var RDG_APP = "RD SK app", RDG_AI = "AI chat", RDG_EMAILS = "Emails", RDG_DECISIONS = "Decisions & reviews", RDG_INSIGHTS = "Research insights";
var RDG_AI_HEAD = ["Date", "Paper", "Approach", "Question", "Journal", "Details", "Answer", "By", "ID"];
var RDG_MARK = "rdsk-master";

function rdgStr(x) { return x === null || x === undefined ? "" : String(x).trim(); }
function rdgNorm(x) { return rdgStr(x).toLowerCase().replace(/\s+/g, " "); }
function rdgQ(title) { return "'" + String(title).replace(/'/g, "''") + "'"; }
function rdgUid() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }); }
function rdgColName(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

// ---------- dates: the sheet stores serial days in its own time zone ----------
var RDG_EPOCH = Date.UTC(1899, 11, 30);
function rdgTzOffset(tz, ms) {
  try {
    var p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    var g = function (t) { for (var i = 0; i < p.length; i++) if (p[i].type === t) return +p[i].value; return 0; };
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
  } catch (e) { return 0; }
}
function rdgDay(x) {                                    // cell -> "YYYY-MM-DD" or ""
  if (typeof x === "number" && x > 0) return new Date(RDG_EPOCH + Math.round(x * 864e5)).toISOString().slice(0, 10);
  var s = rdgStr(x); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}
function rdgMs(x, tz) {                                 // Updated cell -> epoch ms (0 if empty)
  if (typeof x === "number" && x > 0) { var local = RDG_EPOCH + x * 864e5; return local - rdgTzOffset(tz, local); }
  var t = Date.parse(rdgStr(x)); return isNaN(t) ? 0 : t;
}
function rdgStamp(ms, tz) { return new Date(ms + rdgTzOffset(tz, ms)).toISOString().slice(0, 19).replace("T", " "); }

/** A value as typed into the sheet: dates as ISO text (Sheets makes them dates), text protected from becoming numbers/formulas. */
function rdgCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  var s = String(v);
  if (/^[=+\-@]/.test(s) || /^[\d\s.,\/:%-]+$/.test(s) && /\d/.test(s)) return "'" + s;
  return s;
}

// ---------- reading a tab into an editable block ----------
function rdgDateCols(b, C) { ["submitted", "decided", "liveAt", "updated"].forEach(function (f) { if (C[f]) b.dates[C[f] - 1] = 1; }); }
function rdgCols(head, spec) {
  var C = {}, taken = {};
  Object.keys(spec).forEach(function (f) {
    for (var c = 0; c < head.length; c++) {
      var h = rdgStr(head[c]);
      if (!taken[c] && h && spec[f].test(h) && !(f === "rating" && /abdc/i.test(h))) { C[f] = c + 1; taken[c] = 1; break; }
    }
  });
  return C;
}
function rdgBlock(title, values, formulas) {
  // the API leaves out trailing empty rows and cells; formula rows can run further than value rows
  var head = (values[0] || (formulas || [])[0] || []).slice(), f = (formulas || []).slice(1), rows = values.slice(1), n = head.length;
  while (rows.length < f.length) rows.push([]);
  rows.forEach(function (r) { n = Math.max(n, r.length); }); f.forEach(function (r) { n = Math.max(n, r.length); });
  var pad = function (r) { r = (r || []).slice(); while (r.length < n) r.push(""); return r; };
  var v = rows.map(pad), fm = v.map(function (r, i) { return pad(f[i]).map(function (x) { return typeof x === "string" && x.charAt(0) === "=" ? x : ""; }); });
  return { title: title, head: pad(head), v: v, f: fm, n: n, dirty: {}, headDirty: false, used: {}, dates: {} };
}
function rdgAddCols(b, C, add) {
  Object.keys(add || {}).forEach(function (f) {
    if (C[f]) return;
    b.head.push(add[f]); b.n++; C[f] = b.n; b.headDirty = true;
    b.v.forEach(function (r) { r.push(""); }); b.f.forEach(function (r) { r.push(""); });
  });
}
function rdgFree(b, isFree, near) {
  if (near >= 0) for (var i = near + 1; i < b.v.length && isFree(b.v[i]); i++) if (!b.used[i]) { b.used[i] = 1; return i; }
  var last = -1; for (var k = b.v.length - 1; k >= 0; k--) if (!isFree(b.v[k])) { last = k; break; }
  for (var j = last + 1; j < b.v.length; j++) if (!b.used[j]) { b.used[j] = 1; return j; }
  var row = []; for (var c = 0; c < b.n; c++) row.push("");
  b.v.push(row); b.f.push(row.slice()); b.used[b.v.length - 1] = 1; b.added = (b.added || 0) + 1;
  return b.v.length - 1;
}
/** Value ranges for the changed rows, skipping formula cells (ABDC, Days, helper columns keep their formulas). */
function rdgWrites(b) {
  var out = [];
  if (b.headDirty) out.push({ range: rdgQ(b.title) + "!A1", values: [b.head] });
  Object.keys(b.dirty).forEach(function (k) {
    var i = +k, r = b.v[i], c = 0;
    while (c < b.n) {
      if (b.f[i][c]) { c++; continue; }
      var start = c, seg = [];
      while (c < b.n && !b.f[i][c]) { seg.push(b.dates[c] && typeof r[c] === "string" ? r[c] : rdgCell(r[c])); c++; }
      out.push({ range: rdgQ(b.title) + "!" + rdgColName(start + 1) + (i + 2), values: [seg] });
    }
  });
  return out;
}

async function rdgMeta(api, id) {
  return api("GET", "spreadsheets/" + id + "?fields=properties(title,timeZone),sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))");
}
async function rdgRead(api, id, titles, formulasFor) {
  var q = titles.map(function (t) { return "ranges=" + encodeURIComponent(rdgQ(t)); }).join("&");
  var vals = await api("GET", "spreadsheets/" + id + "/values:batchGet?" + q + "&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER");
  var out = {};
  (vals.valueRanges || []).forEach(function (r, i) { out[titles[i]] = { values: r.values || [] }; });
  if (formulasFor && formulasFor.length) {
    var q2 = formulasFor.map(function (t) { return "ranges=" + encodeURIComponent(rdgQ(t)); }).join("&");
    var fx = await api("GET", "spreadsheets/" + id + "/values:batchGet?" + q2 + "&valueRenderOption=FORMULA");
    (fx.valueRanges || []).forEach(function (r, i) { out[formulasFor[i]].formulas = r.values || []; });
  }
  return out;
}
async function rdgEnsureTabs(api, id, meta, tabs) {           // tabs: {title: header row}; hidden tabs start with "RD SK app"
  var have = {}; (meta.sheets || []).forEach(function (s) { have[s.properties.title] = 1; });
  var add = Object.keys(tabs).filter(function (t) { return !have[t]; });
  if (!add.length) return;
  await api("POST", "spreadsheets/" + id + ":batchUpdate", { requests: add.map(function (t) {
    return { addSheet: { properties: { title: t, hidden: t === RDG_APP } } }; }) });
  await api("POST", "spreadsheets/" + id + "/values:batchUpdate", { valueInputOption: "RAW",
    data: add.map(function (t) { return { range: rdgQ(t) + "!A1", values: [tabs[t]] }; }) });
  add.forEach(function (t) { meta.sheets.push({ properties: { title: t } }); });
}
/** New rows past the end of Submissions/Papers get the per-row formulas of the first row that has them. */
function rdgFormulaFill(meta, b) {
  if (!b.added) return [];
  var sh = (meta.sheets || []).filter(function (s) { return s.properties.title === b.title; })[0];
  if (!sh) return [];
  var first = b.v.length - b.added, reqs = [], need = first + b.added + 1 - ((sh.properties.gridProperties || {}).rowCount || 0);
  if (need > 0) reqs.push({ appendDimension: { sheetId: sh.properties.sheetId, dimension: "ROWS", length: need + 20 } });
  for (var c = 0; c < b.n; c++) {
    var src = -1; for (var i = 0; i < first; i++) if (b.f[i][c]) { src = i; break; }
    if (src < 0) continue;
    reqs.push({ copyPaste: { pasteType: "PASTE_FORMULA",
      source: { sheetId: sh.properties.sheetId, startRowIndex: src + 1, endRowIndex: src + 2, startColumnIndex: c, endColumnIndex: c + 1 },
      destination: { sheetId: sh.properties.sheetId, startRowIndex: first + 1, endRowIndex: first + 1 + b.added, startColumnIndex: c, endColumnIndex: c + 1 } } });
    for (var k = first; k < b.v.length; k++) b.f[k][c] = "=";
  }
  return reqs;
}

// ---------- the sync ----------
async function rdgSync(api, id, body, opts) {
  opts = opts || {};
  var meta = await rdgMeta(api, id), tz = (meta.properties || {}).timeZone || "UTC";
  var titles = {}; (meta.sheets || []).forEach(function (s) { titles[s.properties.title] = 1; });
  if (!titles.Papers || !titles.Submissions) throw new Error("This sheet needs tabs called 'Papers' and 'Submissions'.");
  var want = ["Papers", "Submissions"].concat([RDG_APP, "Journals", RDG_EMAILS, RDG_DECISIONS, RDG_INSIGHTS, RDG_AI].filter(function (t) { return titles[t]; }));
  var raw = await rdgRead(api, id, want, ["Papers", "Submissions"].concat(titles.Journals ? ["Journals"] : []));
  var pb = rdgBlock("Papers", raw.Papers.values, raw.Papers.formulas), sb = rdgBlock("Submissions", raw.Submissions.values, raw.Submissions.formulas);
  var P = rdgCols(pb.head, RDG_PAPER), S = rdgCols(sb.head, RDG_SUB);
  if (!P.key || !S.paper || !S.journal || !S.status) throw new Error("Missing Paper / Journal / Status columns.");
  rdgAddCols(pb, P, RDG_ADD_PAPER); rdgAddCols(sb, S, RDG_ADD_SUB); rdgDateCols(pb, P); rdgDateCols(sb, S);
  var g = function (row, C, f) { return C[f] ? row[C[f] - 1] : ""; };
  var put = function (b, i, C, f, v) {
    if (!C[f]) return;
    var old = b.v[i][C[f] - 1];
    if (RDG_DATES[f] ? rdgDay(old) === (v || "") : f === "updated" ? false : rdgStr(old) === rdgStr(v) && (typeof old === "number") === (typeof v === "number")) return;
    b.v[i][C[f] - 1] = v; b.dirty[i] = 1;
  };
  var isSub = function (row) { return !!rdgStr(g(row, S, "journal")); };
  var find = function (b, C, id2, natural) {
    if (id2) for (var i = 0; i < b.v.length; i++) if (rdgStr(b.v[i][C.id - 1]) === id2) return i;
    if (natural) for (var k = 0; k < b.v.length; k++) if (!rdgStr(b.v[k][C.id - 1]) && natural(b.v[k])) return k;
    return -1;
  };
  var subMatch = function (s) {
    return function (row) {
      return isSub(row) && rdgStr(g(row, S, "paper")) === s.paper && rdgNorm(g(row, S, "journal")) === rdgNorm(s.journal) &&
        (rdgDay(g(row, S, "submitted")) === (s.submitted || "") || (rdgStr(g(row, S, "status")) === "Planned" && s.status === "Planned"));
    };
  };
  var now = opts.now || Date.now();

  if (body.link) { // first connection keeping the sheet's data: attach the phone's IDs to matching rows
    (body.papers || []).forEach(function (p) {
      var i = find(pb, P, "", function (row) { return rdgStr(g(row, P, "key")) === p.key; });
      if (i >= 0) put(pb, i, P, "id", p.id);
    });
    (body.subs || []).forEach(function (s) {
      var i = find(sb, S, "", subMatch(s));
      if (i < 0) return;
      put(sb, i, S, "id", s.id);
      if (!rdgStr(g(sb.v[i], S, "msid")) && s.msid) put(sb, i, S, "msid", s.msid);
      if (!rdgStr(g(sb.v[i], S, "live")) && s.live) { put(sb, i, S, "live", s.live); put(sb, i, S, "liveAt", s.liveAt || ""); }
    });
    body.papers = []; body.subs = []; body.deleted = [];
  }

  (body.papers || []).forEach(function (p) {
    var i = find(pb, P, p.id, function (row) { return rdgStr(g(row, P, "key")) === p.key || (p.oldKey && rdgStr(g(row, P, "key")) === p.oldKey); });
    if (i < 0) i = rdgFree(pb, function (row) { return !rdgStr(g(row, P, "key")); }, -1);
    else if (!body.overwrite && rdgMs(g(pb.v[i], P, "updated"), tz) > (p.mod || 0)) return;
    var old = rdgStr(g(pb.v[i], P, "key"));
    put(pb, i, P, "key", p.key); put(pb, i, P, "title", p.title || ""); put(pb, i, P, "authors", p.authors || "");
    put(pb, i, P, "type", p.type || ""); put(pb, i, P, "override", p.override || ""); put(pb, i, P, "notes", p.notes || "");
    if (p.approach !== undefined) put(pb, i, P, "approach", p.approach || "");
    put(pb, i, P, "id", p.id); put(pb, i, P, "updated", rdgStamp(p.mod || now, tz));
    if (old && old !== p.key) sb.v.forEach(function (r, k) { if (rdgStr(g(r, S, "paper")) === old) put(sb, k, S, "paper", p.key); });
  });
  (body.subs || []).forEach(function (s) {
    var i = find(sb, S, s.id, subMatch(s));
    if (i < 0) {
      var near = -1; for (var k = sb.v.length - 1; k >= 0; k--) if (rdgStr(g(sb.v[k], S, "paper")) === s.paper) { near = k; break; }
      i = rdgFree(sb, function (row) { return !rdgStr(g(row, S, "paper")) && !rdgStr(g(row, S, "journal")); }, near);
    } else if (!body.overwrite && rdgMs(g(sb.v[i], S, "updated"), tz) > (s.mod || 0)) return;
    put(sb, i, S, "paper", s.paper); put(sb, i, S, "journal", s.journal); put(sb, i, S, "rating", s.rating || "");
    put(sb, i, S, "status", s.status || ""); put(sb, i, S, "submitted", s.submitted || ""); put(sb, i, S, "decided", s.decided || "");
    put(sb, i, S, "notes", s.notes || ""); put(sb, i, S, "titleUsed", s.titleUsed || ""); put(sb, i, S, "msid", s.msid || "");
    put(sb, i, S, "live", s.live || ""); put(sb, i, S, "liveAt", s.liveAt || ""); put(sb, i, S, "dtype", s.dtype || "");
    put(sb, i, S, "id", s.id); put(sb, i, S, "updated", rdgStamp(s.mod || now, tz));
  });
  (body.deleted || []).forEach(function (did) {
    var i = find(pb, P, did, null);
    if (i >= 0) ["key", "title", "authors", "type", "override", "notes", "suggest", "id", "updated", "approach"].forEach(function (f) { put(pb, i, P, f, ""); });
    i = find(sb, S, did, null);
    if (i >= 0) ["paper", "journal", "rating", "status", "submitted", "decided", "notes", "titleUsed", "msid", "live", "liveAt", "dtype", "id", "updated"]
      .forEach(function (f) { put(sb, i, S, f, ""); });
  });

  // IDs for rows typed into the sheet by hand
  pb.v.forEach(function (r, i) { if (rdgStr(g(r, P, "key")) && !rdgStr(g(r, P, "id"))) put(pb, i, P, "id", rdgUid()); });
  sb.v.forEach(function (r, i) { if (isSub(r) && !rdgStr(g(r, S, "id"))) put(sb, i, S, "id", rdgUid()); });

  // suggested next journals (the app's own method and ABDC list)
  if (opts.suggest && opts.abdc && P.suggest) pb.v.forEach(function (r, i) {
    var key = rdgStr(g(r, P, "key"));
    if (!key) return;
    if (rdgStr(g(r, P, "override"))) { put(pb, i, P, "suggest", ""); return; }
    var mine = sb.v.filter(function (x) { return isSub(x) && rdgStr(g(x, S, "paper")) === key; }).map(function (x) {
      return { journal: rdgStr(g(x, S, "journal")), status: rdgStr(g(x, S, "status")), submitted: rdgDay(g(x, S, "submitted")) };
    });
    put(pb, i, P, "suggest", opts.suggest({ key: key, title: rdgStr(g(r, P, "title")) }, mine, opts.abdc, 5)
      .map(function (j) { return j.title + " (" + j.grade + ")"; }).join(" · "));
  });

  // app settings (hidden tab) and the Journals tab (login links, editorial emails, ABDC)
  var app = {};
  if (raw[RDG_APP]) raw[RDG_APP].values.slice(1).forEach(function (r) { try { app[r[0]] = JSON.parse(r[1]); } catch (e) {} });
  var jb = raw.Journals ? rdgBlock("Journals", raw.Journals.values, raw.Journals.formulas) : null, J = jb ? rdgCols(jb.head, RDG_JOURNAL) : null;
  var inc = body.app, appDirty = false;
  if (inc) {
    ["portals", "contacts"].forEach(function (k) { if (inc[k]) { var m = Object.assign({}, app[k] || {}, inc[k]); if (JSON.stringify(m) !== JSON.stringify(app[k] || {})) { app[k] = m; appDirty = true; } } });
    if (inc.chaseDays && inc.chaseDays !== app.chaseDays) { app.chaseDays = inc.chaseDays; appDirty = true; }
    ["settings", "secrets"].forEach(function (k) { if (inc[k]) { var m = Object.assign({}, app[k] || {}, inc[k]); if (JSON.stringify(m) !== JSON.stringify(app[k] || {})) { app[k] = m; appDirty = true; } } });
    if (J && J.journal) {
      var at = {}; jb.v.forEach(function (r, i) { if (rdgStr(r[J.journal - 1])) at[rdgNorm(r[J.journal - 1])] = i; });
      [["portals", "link"], ["contacts", "email"]].forEach(function (x) {
        if (!J[x[1]]) return;
        Object.keys(inc[x[0]] || {}).forEach(function (name) {
          var v = inc[x[0]][name]; if (!v) return;
          var i = at[rdgNorm(name)];
          if (i === undefined) { i = rdgFree(jb, function (r) { return !rdgStr(r[J.journal - 1]); }, -1); jb.v[i][J.journal - 1] = name; jb.dirty[i] = 1; at[rdgNorm(name)] = i; }
          if (rdgStr(jb.v[i][J[x[1]] - 1]) !== v) { jb.v[i][J[x[1]] - 1] = v; jb.dirty[i] = 1; }
        });
      });
    }
  }

  // journal emails: decisions chosen in the app, emails confirmed/dismissed in the app, emails still waiting
  var writes = [], eb = raw[RDG_EMAILS] ? rdgBlock(RDG_EMAILS, raw[RDG_EMAILS].values) : null;
  if (body.emailDecisions && body.emailDecisions.length && raw[RDG_DECISIONS]) {
    var db = rdgBlock(RDG_DECISIONS, raw[RDG_DECISIONS].values);
    body.emailDecisions.forEach(function (x) { db.v.forEach(function (r, i) { if (rdgStr(r[9]) === x.id) {
      r[1] = x.paper || r[1]; r[2] = x.journal || r[2]; r[3] = x.status || r[3]; r[4] = x.dtype || r[4]; db.dirty[i] = 1; } }); });
    writes = writes.concat(rdgWrites(db));
  }
  var pending = [];
  if (eb) {
    var done = {}; (body.resolved || []).forEach(function (x) { done[x.id] = x.action || "Confirmed in the app"; });
    var textCol = eb.head.indexOf("Text");
    eb.v.forEach(function (r, i) {
      if (rdgStr(r[9]) !== "Needs confirmation") return;
      var mid = rdgStr(r[11]);
      if (done[mid]) { r[9] = done[mid]; eb.dirty[i] = 1; return; }
      pending.push({ id: mid, date: rdgDay(r[0]) || rdgStr(r[0]).slice(0, 10), from: rdgStr(r[1]), subject: rdgStr(r[2]), paper: rdgStr(r[3]),
        journal: rdgStr(r[4]), guess: rdgStr(r[5]), dtype: rdgStr(r[6]), reviews: +r[7] || 0, msid: rdgStr(r[8]), link: rdgStr(r[10]),
        body: textCol >= 0 ? rdgStr(r[textCol]).slice(0, 4000) : "" });
    });
    writes = writes.concat(rdgWrites(eb));
  }

  // research insights written by the helper script (last 14 days + saved ones); stars from the app
  var insights = [];
  if (raw[RDG_INSIGHTS]) {
    var ib = rdgBlock(RDG_INSIGHTS, raw[RDG_INSIGHTS].values), star = {};
    (body.savedInsights || []).forEach(function (d) { star[String(d).toLowerCase()] = 1; });
    var since = now - 14 * 864e5;
    ib.v.forEach(function (r, i) {
      var doi = rdgStr(r[8]).replace(/^https?:\/\/doi\.org\//, "").toLowerCase();
      if (!doi) return;
      if (star[doi] && rdgStr(r[14]) !== "Yes") { r[14] = "Yes"; ib.dirty[i] = 1; }
      var d = rdgDay(r[0]);
      if ((d ? Date.parse(d) : 0) < since && rdgStr(r[14]) !== "Yes") return;
      insights.push({ date: d, rank: +r[1] || 0, title: rdgStr(r[2]), authors: rdgStr(r[3]), journal: rdgStr(r[4]), abdc: rdgStr(r[5]),
        ft50: !!rdgStr(r[6]), published: rdgDay(r[7]) || rdgStr(r[7]), doi: doi, paper: rdgStr(r[9]), why: rdgStr(r[10]), tip: rdgStr(r[11]),
        abstract: rdgStr(r[12]).slice(0, 1500), by: rdgStr(r[13]), saved: rdgStr(r[14]) === "Yes" });
    });
    writes = writes.concat(rdgWrites(ib));
    insights = insights.slice(-60);
  }

  // AI answers: add the phone's new ones, return the latest 100
  var aiRows = raw[RDG_AI] ? raw[RDG_AI].values.slice(1) : [], appendAi = [];
  if (body.aiLog && body.aiLog.length) {
    var have = {}; aiRows.forEach(function (r) { have[rdgStr(r[8])] = 1; });
    body.aiLog.forEach(function (e) {
      if (!e || !e.id || !e.answer || have[e.id]) return;
      var src = (e.sources || []).map(function (x) { return "\n- " + (x.title || "source") + ": " + x.url; }).join("");
      var row = [rdgStamp(Date.parse(e.at) || now, tz), e.paper || "", e.approach || "", e.kind || "", e.journal || "", e.question || "",
        String(e.answer).slice(0, 45000) + (src ? "\n\nSources:" + src : ""), e.by || "", e.id];
      appendAi.push(row); aiRows.push(row); have[e.id] = 1;
    });
  }
  var ai = aiRows.slice(-100).filter(function (r) { return rdgStr(r[8]) && rdgStr(r[6]); }).map(function (r) {
    var d = typeof r[0] === "number" ? new Date(rdgMs(r[0], tz)).toISOString() : (Date.parse(rdgStr(r[0]).replace(" ", "T")) ? rdgStr(r[0]).replace(" ", "T") : "");
    return { id: rdgStr(r[8]), at: d, paper: rdgStr(r[1]), approach: rdgStr(r[2]), kind: rdgStr(r[3]), journal: rdgStr(r[4]),
             question: rdgStr(r[5]), answer: rdgStr(r[6]), by: rdgStr(r[7]) };
  });

  // write everything back in as few calls as possible
  var tabs = {}; if (appDirty || !raw[RDG_APP]) tabs[RDG_APP] = ["setting", "value (JSON)"]; if (appendAi.length) tabs[RDG_AI] = RDG_AI_HEAD;
  await rdgEnsureTabs(api, id, meta, tabs);
  var reqs = rdgFormulaFill(meta, sb).concat(rdgFormulaFill(meta, pb));
  if (reqs.length) await api("POST", "spreadsheets/" + id + ":batchUpdate", { requests: reqs });
  writes = writes.concat(rdgWrites(pb), rdgWrites(sb), jb ? rdgWrites(jb) : []);
  if (appDirty) {
    var rows = [["setting", "value (JSON)"]];
    Object.keys(app).filter(function (k) { return k !== "abdc"; }).forEach(function (k) { rows.push([k, JSON.stringify(app[k])]); });
    var oldN = raw[RDG_APP] ? raw[RDG_APP].values.length : 0;
    while (rows.length < oldN) rows.push(["", ""]);
    writes.push({ range: rdgQ(RDG_APP) + "!A1", values: rows });
  }
  if (writes.length) await api("POST", "spreadsheets/" + id + "/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: writes });
  if (appendAi.length) await api("POST", "spreadsheets/" + id + "/values/" + encodeURIComponent(rdgQ(RDG_AI) + "!A1") + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
    { values: appendAi.map(function (r) { return r.map(function (x, i) { return i === 0 ? x : rdgCell(x); }); }) });

  var outApp = { portals: Object.assign({}, app.portals || {}), contacts: Object.assign({}, app.contacts || {}), abdc: {},
                 chaseDays: app.chaseDays, settings: app.settings, secrets: app.secrets, script: app.script };
  if (jb && J && J.journal) jb.v.forEach(function (r) {
    var name = rdgStr(r[J.journal - 1]); if (!name) return;
    if (J.link && rdgStr(r[J.link - 1])) outApp.portals[name] = rdgStr(r[J.link - 1]);
    if (J.email && rdgStr(r[J.email - 1])) outApp.contacts[name] = rdgStr(r[J.email - 1]);
    if (J.abdc && rdgStr(r[J.abdc - 1])) outApp.abdc[name] = rdgStr(r[J.abdc - 1]);
  });
  return {
    ok: true, now: now, sheet: (meta.properties || {}).title || "", app: outApp, pending: pending, insights: insights, ai: ai,
    papers: pb.v.filter(function (r) { return rdgStr(g(r, P, "key")); }).map(function (r) {
      return { id: rdgStr(g(r, P, "id")), key: rdgStr(g(r, P, "key")), title: rdgStr(g(r, P, "title")), authors: rdgStr(g(r, P, "authors")),
               type: rdgStr(g(r, P, "type")), override: rdgStr(g(r, P, "override")), notes: rdgStr(g(r, P, "notes")), approach: rdgStr(g(r, P, "approach")) };
    }),
    subs: sb.v.filter(isSub).map(function (r) {
      return { id: rdgStr(g(r, S, "id")), paper: rdgStr(g(r, S, "paper")), journal: rdgStr(g(r, S, "journal")), rating: rdgStr(g(r, S, "rating")),
               abdc: rdgStr(g(r, S, "abdc")), status: rdgStr(g(r, S, "status")), submitted: rdgDay(g(r, S, "submitted")),
               decided: rdgDay(g(r, S, "decided")), notes: rdgStr(g(r, S, "notes")), titleUsed: rdgStr(g(r, S, "titleUsed")),
               msid: rdgStr(g(r, S, "msid")), live: rdgStr(g(r, S, "live")), liveAt: rdgDay(g(r, S, "liveAt")), dtype: rdgStr(g(r, S, "dtype")) };
    })
  };
}

/** First move into a new (empty) sheet: papers in order, each with a shaded heading row, its submissions and spare rows. */
async function rdgReplace(api, id, papers, subs, approachOf) {
  var meta = await rdgMeta(api, id), tz = (meta.properties || {}).timeZone || "UTC";
  var raw = await rdgRead(api, id, ["Papers", "Submissions"], ["Papers", "Submissions"]);
  var pb = rdgBlock("Papers", raw.Papers.values, raw.Papers.formulas), sb = rdgBlock("Submissions", raw.Submissions.values, raw.Submissions.formulas);
  var P = rdgCols(pb.head, RDG_PAPER), S = rdgCols(sb.head, RDG_SUB);
  rdgAddCols(pb, P, RDG_ADD_PAPER); rdgAddCols(sb, S, RDG_ADD_SUB); rdgDateCols(pb, P); rdgDateCols(sb, S);
  var stamp = rdgStamp(Date.now(), tz), at = function (b, i) { while (b.v.length <= i) rdgFree(b, function () { return false; }, -1); b.dirty[i] = 1; return b.v[i]; };
  var set = function (row, C, f, v) { if (C[f]) row[C[f] - 1] = v; };
  papers.forEach(function (p, i) {
    var r = at(pb, i);
    set(r, P, "key", p.key); set(r, P, "title", p.title || ""); set(r, P, "authors", p.authors || ""); set(r, P, "type", p.type || "Journal article");
    set(r, P, "override", p.override || ""); set(r, P, "notes", p.notes || ""); set(r, P, "approach", p.approach || ""); set(r, P, "id", p.id); set(r, P, "updated", stamp);
  });
  var n = 0, heads = [];
  papers.forEach(function (p) {
    var h = at(sb, n); set(h, S, "paper", p.key); set(h, S, "notes", (p.title || "") + (p.authors ? "  ·  " + p.authors : "")); heads.push(n++);
    subs.filter(function (s) { return s.paper === p.id; }).forEach(function (s) {
      var r = at(sb, n++);
      set(r, S, "paper", p.key); set(r, S, "journal", s.journal); set(r, S, "rating", s.rating || ""); set(r, S, "status", s.status || "Planned");
      set(r, S, "submitted", s.submitted || ""); set(r, S, "decided", s.decided || ""); set(r, S, "notes", s.notes || ""); set(r, S, "titleUsed", s.titleUsed || "");
      set(r, S, "msid", s.msid || ""); set(r, S, "live", s.live ? s.live.text : ""); set(r, S, "liveAt", s.live ? s.live.at : ""); set(r, S, "dtype", s.dtype || "");
      set(r, S, "id", s.id); set(r, S, "updated", stamp);
    });
    n += p.override ? 2 : 4;
  });
  var reqs = rdgFormulaFill(meta, sb).concat(rdgFormulaFill(meta, pb));
  var sh = meta.sheets.filter(function (s) { return s.properties.title === "Submissions"; })[0].properties.sheetId;
  heads.forEach(function (i) {
    reqs.push({ repeatCell: { range: { sheetId: sh, startRowIndex: i + 1, endRowIndex: i + 2, startColumnIndex: 0, endColumnIndex: Math.max(S.updated || 15, 15) },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.933, green: 0.953, blue: 0.973 }, textFormat: { bold: true, foregroundColor: { red: 0.184, green: 0.365, blue: 0.541 } } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } });
  });
  if (reqs.length) await api("POST", "spreadsheets/" + id + ":batchUpdate", { requests: reqs });
  var writes = rdgWrites(pb).concat(rdgWrites(sb));
  for (var k = 0; k < writes.length; k += 400)
    await api("POST", "spreadsheets/" + id + "/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: writes.slice(k, k + 400) });
  return { papers: papers.length, subs: subs.length };
}

/** Sheets this app created in the signed-in account's Drive (marked with an app property), newest first. */
async function rdgFind(api) {
  var q = encodeURIComponent("appProperties has { key='" + RDG_MARK + "' and value='1' } and trashed=false");
  var r = await api("GET", "https://www.googleapis.com/drive/v3/files?q=" + q + "&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&spaces=drive");
  return r.files || [];
}
function rdgCreateMeta(title) {
  return JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.spreadsheet", appProperties: { "rdsk-master": "1" } });
}

if (typeof module !== "undefined") module.exports = { rdgSync: rdgSync, rdgReplace: rdgReplace, rdgFind: rdgFind, rdgCreateMeta: rdgCreateMeta,
  rdgDay: rdgDay, rdgMs: rdgMs, rdgStamp: rdgStamp, rdgTzOffset: rdgTzOffset, rdgCell: rdgCell };
