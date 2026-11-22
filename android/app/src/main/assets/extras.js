/* RD SK extras: revision helper, journal profiles, research year recap, calls for papers, publications & CV,
   reviewing tracker, goals, weekly plan, manuscript files. Uses the main app's globals (S, $, esc, openSheet …);
   records sync through the sheet's hidden settings tab (recPut / recList in index.html). */
"use strict";
const XA = {};
const yr = d => (d || "").slice(0, 4);
const thisYear = () => today().slice(0, 4);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysTo = iso => iso ? daysBetween(today(), iso) : null;
const plural = (n, w, p) => n + " " + (n === 1 ? w : (p || w + "s"));
const xaGeminiKey = () => (window.GS && GS.gemini) || "";
function countdown(iso) {
  const d = daysTo(iso); if (d == null) return "";
  const col = d < 0 ? "var(--closed)" : d <= 7 ? "var(--need)" : d <= 30 ? "var(--warn)" : "var(--acc)";
  const t = d < 0 ? plural(-d, "day") + " ago" : d === 0 ? "today" : d === 1 ? "tomorrow" : "in " + plural(d, "day");
  return `<span class="chip" style="background:transparent;border:1px solid ${col};color:${col}">${t}</span>`;
}
function lbl(t, id) { return `<label for="${id}">${t}</label>`; }
const sheetBack = fn => `<button class="ghost" data-xback="${fn}">← Back</button>`;
document.addEventListener("click", e => { const b = e.target.closest("[data-xback]"); if (b) { e.stopPropagation(); const f = XA[b.dataset.xback]; if (f) f(); else closeSheet(); } }, true);

/* =====================================================================================================
   1. Revision helper: reviewer comments → numbered points → response letter
   ===================================================================================================== */
const REV_HEAD = /^\s*(?:comments?\s+(?:from|of|by)\s+)?(reviewer|referee|editor|associate editor|handling editor|guest editor|ae|eic)\b\s*#?\s*(\d+|[ivx]+|[a-c])?\s*[:.\-–)]?\s*(?:comments?(?:\s+to\s+(?:the\s+)?authors?)?)?\s*[:.]?\s*$/i;
const REV_ITEM = /^\s*(?:\(?\d{1,2}(?:\.\d{1,2})?[.):]|\(?[a-h]\)|[-•*▪●–]|comment\s*\d+\s*[:.]|point\s*\d+\s*[:.]|R\d+\.\d+[:.]?)\s+/i;
const REV_SKIP = /^(dear|sincerely|best regards|kind regards|regards|yours|thank you for submitting|with best wishes|editor[- ]in[- ]chief\s*$|https?:\/\/|\*{3,}|-{3,}|={3,}|reviewer\(s\)' comments to author:?$|comments to the author:?$)/i;
/** Splits a decision letter into reviewer points: by reviewer headings, then numbered or bulleted items, else paragraphs. */
function revSplit(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const sections = []; let cur = { rev: "Editor", lines: [] };
  lines.forEach(l => {
    const m = REV_HEAD.exec(l.trim());
    if (m && l.trim().length < 70) { if (cur.lines.join("").trim()) sections.push(cur); const n = m[2] ? " " + m[2].toUpperCase() : ""; const w = m[1].toLowerCase();
      cur = { rev: (w === "ae" ? "Associate Editor" : w === "eic" ? "Editor" : w.replace(/\b\w/g, c => c.toUpperCase())) + n, lines: [] }; return; }
    cur.lines.push(l);
  });
  if (cur.lines.join("").trim()) sections.push(cur);
  const points = [];
  sections.forEach(sec => {
    const items = []; let buf = [];
    const flush = () => { const t = buf.join(" ").replace(/\s+/g, " ").trim(); if (t.length >= 25 && !REV_SKIP.test(t)) items.push(t); buf = []; };
    const numbered = sec.lines.filter(l => REV_ITEM.test(l)).length >= 2;
    sec.lines.forEach(l => {
      const t = l.trim();
      if (!t) { if (!numbered) flush(); return; }
      if (REV_SKIP.test(t)) { flush(); return; }
      if (numbered && REV_ITEM.test(l)) { flush(); buf.push(t.replace(REV_ITEM, "")); return; }
      buf.push(t);
    });
    flush();
    // the editor's own covering letter: keep only lines that ask for something
    const keep = sec.rev === "Editor" && sections.length > 1 ? items.filter(t => /please|should|need|must|address|clarif|revise|consider|suggest|recommend|request|ensure/i.test(t)) : items;
    keep.forEach(t => points.push({ id: uid("q"), rev: sec.rev, text: t, reply: "", change: "", who: "", done: false }));
  });
  return points;
}
function revFor(sub) { return recList("rev").find(r => r.sub === sub.id) || null; }
function revOpen() { return recList("rev").filter(r => { const s = S.subs.find(x => x.id === r.sub); return s && s.status === "Revision requested"; }); }
XA.revSheet = function (sub) {
  if (typeof sub === "string") sub = S.subs.find(x => x.id === sub);
  if (!sub) return;
  const p = paperById(sub.paper) || {}, r = revFor(sub);
  if (!r) {
    openSheet(`<h3><span>✍ Revision plan</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
      <div class="m"><b style="color:var(--ink)">${esc(p.key)}</b> · ${esc(sub.journal)}</div>
      ${lbl("Paste the decision letter or the reviewers' comments", "rvt")}
      <textarea id="rvt" style="min-height:180px" placeholder="Reviewer 1&#10;1. The theoretical contribution is unclear…&#10;2. …&#10;&#10;Reviewer 2&#10;…"></textarea>
      <div class="actions" style="margin-top:4px"><button id="rvpaste">📋 Paste</button></div>
      <div class="two"><div>${lbl("Revision due", "rvd")}<input type="date" id="rvd" value="${esc(sub.revDue || addDays(today(), 60))}"></div><div>${lbl("Round", "rvr")}<input id="rvr" type="number" min="1" value="1"></div></div>
      <div class="actions"><button class="primary" id="rvgo">Split into points</button><button id="rvblank">Start empty</button></div>
      <div class="hint">RD SK splits the text by reviewer and by numbered points. You can edit, merge or add points afterwards.</div>`);
    $("#rvpaste").onclick = () => { const c = (window.Android && Android.getClipboard) ? Android.getClipboard() : ""; if (c) $("#rvt").value = c; else if (navigator.clipboard) navigator.clipboard.readText().then(t => $("#rvt").value = t, () => toast("Long-press the box and paste")); };
    const make = pts => { const rec = recPut("rev", { sub: sub.id, paper: sub.paper, journal: sub.journal, due: $("#rvd").value, round: +$("#rvr").value || 1, points: pts, letter: "" }); XA.revSheet(sub); toast(pts.length ? plural(pts.length, "point") + " to address" : "Plan started"); return rec; };
    $("#rvgo").onclick = () => { const t = $("#rvt").value.trim(); if (!t) return toast("Paste the comments first"); const pts = revSplit(t); if (!pts.length) return toast("Couldn't find points: try Start empty"); make(pts); };
    $("#rvblank").onclick = () => make([]);
    return;
  }
  const pts = r.points || [], done = pts.filter(x => x.done).length, pct = pts.length ? Math.round(done * 100 / pts.length) : 0;
  const authors = (p.authors || "").split(/;|,(?=\s*[A-Z][a-z]+,)| and /).map(x => x.trim()).filter(Boolean);
  const people = ["Me"].concat(authors.filter(a => !/^me$/i.test(a)).map(a => a.split(",")[0].trim())).filter((v, i, a) => a.indexOf(v) === i);
  const groups = []; pts.forEach((q, i) => { let g = groups.find(x => x.rev === q.rev); if (!g) groups.push(g = { rev: q.rev, items: [] }); g.items.push([q, i]); });
  openSheet(`<h3><span>✍ Revision plan</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="m"><b style="color:var(--ink)">${esc(p.key)}</b> · ${esc(sub.journal)}${r.round > 1 ? " · round " + r.round : ""} · due ${fmt(r.due)} ${countdown(r.due)}</div>
    <div class="prog" style="margin:10px 0 4px;height:10px;border-radius:6px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:var(--acc);transition:width .6s"></i></div>
    <div class="m">${done} of ${plural(pts.length, "point")} addressed${pct === 100 && pts.length ? " 🎉 ready to resubmit" : ""}</div>
    <div class="filters" style="margin-top:8px"><button data-rvf="all" class="${XA.rvf !== "open" && XA.rvf !== "mine" ? "on" : ""}">All</button><button data-rvf="open" class="${XA.rvf === "open" ? "on" : ""}">To do</button>${people.length > 1 ? `<button data-rvf="mine" class="${XA.rvf === "mine" ? "on" : ""}">Mine</button>` : ""}</div>
    ${groups.map(g => `<h2>${esc(g.rev)} <small>${g.items.filter(([q]) => q.done).length}/${g.items.length}</small></h2>` + g.items.filter(([q]) => XA.rvf === "open" ? !q.done : XA.rvf === "mine" ? (!q.who || q.who === "Me") : true).map(([q, i]) => `
      <div class="card" data-rvi="${i}" style="${q.done ? "opacity:.72" : ""}">
        <div class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" data-rvdone="${i}" ${q.done ? "checked" : ""} style="width:auto;margin-top:4px">
          <div class="grow"><b>${i + 1}.</b> <span class="rvtext" style="white-space:pre-wrap">${esc(q.text)}</span></div></div>
        <label style="margin-top:6px">Response</label><textarea data-rvk="reply" data-i="${i}" style="min-height:60px" placeholder="We thank the reviewer… We have…">${esc(q.reply)}</textarea>
        <div class="two"><div><label>Change made (where)</label><input data-rvk="change" data-i="${i}" value="${esc(q.change)}" placeholder="e.g. Section 2.1, p. 6"></div>
        <div><label>Who</label><select data-rvk="who" data-i="${i}">${["", ...people].map(n => `<option value="${esc(n)}" ${q.who === n ? "selected" : ""}>${n ? esc(n) : "—"}</option>`).join("")}</select></div></div>
        <div class="actions" style="margin-top:4px"><button class="link" data-rvedit="${i}">Edit comment</button><button class="link" data-rvdel="${i}">Remove</button></div>
      </div>`).join("")).join("")}
    <div class="actions"><button data-rvadd>+ Add a point</button><button data-rvmore>+ Paste more comments</button></div>
    <h2>Response letter</h2>
    <div class="actions" style="margin-top:0"><button class="primary" data-rvletter>📄 Draft the response letter</button>${xaGeminiKey() ? `<button data-rvai>✦ Suggest replies with Gemini</button>` : ""}</div>
    ${people.length > 1 ? `<div class="actions"><button data-rvsend>📤 Send each co-author their points</button></div>` : ""}
    ${window.XB && r.due ? `<div class="actions">${XB.calBtn("✍ Revision due: " + sub.journal, r.due, p.key || "")}</div>` : ""}
    <div class="two" style="margin-top:8px"><div><label for="rvdue">Revision due</label><input type="date" id="rvdue" value="${esc(r.due || "")}"></div><div style="align-self:end"><button class="danger" data-rvkill style="width:100%">Delete plan</button></div></div>
    ${xaGeminiKey() ? "" : `<div class="hint">Add a free Gemini key (More → Ask AI) to get suggested replies for points you haven't answered yet.</div>`}`);
  const save = (render2) => { r.points = pts; recPut("rev", r); if (render2) XA.revSheet(sub); };
  const sh = $("#sheet");
  sh.onchange = e => {
    const k = e.target.dataset.rvk; if (k) { pts[+e.target.dataset.i][k] = e.target.value; save(false); return; }
    if (e.target.dataset.rvdone != null) { const q = pts[+e.target.dataset.rvdone]; q.done = e.target.checked; save(true); if (q.done) { FX.spark(lastTap.x, lastTap.y); if (pts.every(x => x.done)) { FX.confetti(140); toast("All points addressed 🎉"); } } return; }
    if (e.target.id === "rvdue") { r.due = e.target.value; save(false); toast("Saved"); }
  };
  sh.onclick = e => {
    const t = e.target.closest("button,[data-rvf]"); if (!t) return;
    const d = t.dataset;
    if (d.rvf) { XA.rvf = d.rvf; return XA.revSheet(sub); }
    if (d.rvdel != null) { if (confirm("Remove this point?")) { pts.splice(+d.rvdel, 1); save(true); } return; }
    if (d.rvedit != null) { const q = pts[+d.rvedit], v = prompt("Reviewer's comment", q.text); if (v != null && v.trim()) { q.text = v.trim(); save(true); } return; }
    if (d.rvadd != null) { const v = prompt("The reviewer's comment"); if (v && v.trim()) { const rev = prompt("From whom? (e.g. Reviewer 2)", (pts[pts.length - 1] || {}).rev || "Reviewer 1") || "Reviewer 1"; pts.push({ id: uid("q"), rev, text: v.trim(), reply: "", change: "", who: "", done: false }); save(true); } return; }
    if (d.rvmore != null) { const v = prompt("Paste more comments (they are added to the list)"); if (v && v.trim()) { const more = revSplit(v); pts.push(...more); save(true); toast(plural(more.length, "point") + " added"); } return; }
    if (d.rvletter != null) return XA.revLetter(sub);
    if (d.rvai != null) return XA.revAI(sub, r);
    if (d.rvsend != null) return XA.revSend(sub, r, people);
    if (d.rvkill != null) { if (confirm("Delete this revision plan? (The submission itself stays.)")) { recDel("rev", r.id); closeSheet(); render(); } }
  };
};
/** The response letter: thanks, then each reviewer's points with your reply and the change made. */
XA.letterText = function (sub, r) {
  const p = paperById(sub.paper) || {}, title = sub.titleUsed || p.title || p.key, name = S.settings.myName || "[Your name]";
  const many = /,|;| and /.test(p.authors || "");
  const groups = []; (r.points || []).forEach(q => { let g = groups.find(x => x.rev === q.rev); if (!g) groups.push(g = { rev: q.rev, items: [] }); g.items.push(q); });
  let out = `Response to the reviewers\n\nManuscript: “${title}”${sub.msid ? "\nManuscript ID: " + sub.msid : ""}\nJournal: ${sub.journal}\n\nDear Editor${groups.some(g => /reviewer|referee/i.test(g.rev)) ? " and Reviewers" : ""},\n\n`;
  out += `Thank you for the opportunity to revise ${many ? "our" : "my"} manuscript. ${many ? "We are" : "I am"} grateful for the careful and constructive comments, which have helped to strengthen the paper considerably. Below, each comment is followed by ${many ? "our" : "my"} response and a note of where the change appears in the revised manuscript.\n`;
  groups.forEach((g, gi) => {
    out += `\n${"=".repeat(8)}\n${g.rev.toUpperCase()}\n${"=".repeat(8)}\n`;
    g.items.forEach((q, i) => {
      out += `\nComment ${gi + 1}.${i + 1}: ${q.text}\n\nResponse: ${q.reply || "[response]"}\n` + (q.change ? `Change made: ${q.change}\n` : "");
    });
  });
  out += `\nOnce again, thank you for your time and guidance. ${many ? "We hope" : "I hope"} the revised manuscript is now suitable for publication in ${sub.journal}.\n\nKind regards,\n${name}${many ? "\n(on behalf of all authors)" : ""}\n`;
  return out;
};
XA.revLetter = function (sub) {
  const r = revFor(sub); if (!r) return;
  const t = XA.letterText(sub, r), open = (r.points || []).filter(q => !q.reply).length;
  openSheet(`<h3><span>📄 Response letter</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${open ? `<div class="banner">⚠ ${plural(open, "point")} still without a response ([response] in the text).</div>` : ""}
    <textarea id="rvlt" style="min-height:360px;font-size:13.5px">${esc(t)}</textarea>
    <div class="actions"><button class="primary" id="rvlc">Copy</button><button id="rvls">Share…</button><button id="rvlf">Save as .txt</button><button data-xback="revBackTo">← Back to the plan</button></div>`);
  XA.revBackTo = () => XA.revSheet(sub);
  $("#rvlc").onclick = () => copyOut($("#rvlt").value);
  $("#rvls").onclick = () => shareOut("Response to reviewers", $("#rvlt").value);
  $("#rvlf").onclick = () => saveFile("Response-to-reviewers-" + ((paperById(sub.paper) || {}).key || "paper").replace(/[^\w]+/g, "-").slice(0, 40) + ".txt", $("#rvlt").value, "text/plain");
};
XA.revAI = async function (sub, r) {
  const p = paperById(sub.paper) || {}, todo = (r.points || []).map((q, i) => [q, i]).filter(([q]) => !q.reply);
  if (!todo.length) return toast("Every point already has a response");
  toast("Asking Gemini for draft replies…");
  const prompt = `You are helping an academic author respond to peer review for the paper "${p.title || p.key}" (${p.approach || "research"} paper) at ${sub.journal}.
Paper notes: ${p.notes || "-"}
For each reviewer comment below, draft a courteous, specific response in the first person plural (2-4 sentences): thank the reviewer where natural, say concretely what will be changed, and avoid inventing results or page numbers (use [section] placeholders).
Return ONLY a JSON array like [{"n":1,"reply":"..."}] with one object per comment, using the comment numbers given.

${todo.map(([q, i]) => `Comment ${i + 1} (${q.rev}): ${q.text}`).join("\n\n")}`;
  try {
    const ans = await geminiAsk(xaGeminiKey(), prompt), txt = typeof ans === "string" ? ans : (ans && ans.text) || "";
    const m = txt.match(/\[[\s\S]*\]/); const arr = m ? JSON.parse(m[0]) : [];
    let n = 0; arr.forEach(o => { const q = (r.points || [])[(+o.n) - 1]; if (q && !q.reply && o.reply) { q.reply = String(o.reply).trim() + " [AI draft: check]"; n++; } });
    recPut("rev", r); XA.revSheet(sub); toast(n ? plural(n, "draft reply", "draft replies") + " added: edit them before sending" : "Gemini gave no usable replies");
  } catch (err) { alert("Gemini: " + err.message); }
};
XA.revSend = function (sub, r, people) {
  const p = paperById(sub.paper) || {};
  openSheet(`<h3><span>📤 Points for co-authors</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="m">Assign points with “Who” first. Each button shares that person's list (by WhatsApp, email…).</div>
    ${people.filter(n => n !== "Me").map(n => { const mine = (r.points || []).filter(q => q.who === n); return `<div class="card"><div class="t">${esc(n)}</div><div class="m">${plural(mine.length, "point")} · ${mine.filter(q => q.done).length} done</div>
      <div class="actions"><button data-rvto="${esc(n)}" ${mine.length ? "" : "disabled"}>Share their points</button></div></div>`; }).join("")}
    <div class="actions"><button data-xback="revBackTo">← Back to the plan</button></div>`);
  XA.revBackTo = () => XA.revSheet(sub);
  $("#sheet").onclick = e => { const b = e.target.closest("[data-rvto]"); if (!b) return; const n = b.dataset.rvto, mine = (r.points || []).map((q, i) => [q, i]).filter(([q]) => q.who === n);
    shareOut("Revision points", `Hi ${n.split(/\s/)[0]},\n\nFor the revision of “${p.title || p.key}” (${sub.journal}${r.due ? ", due " + fmt(r.due) : ""}), could you take these points?\n\n` +
      mine.map(([q, i]) => `${i + 1}. [${q.rev}] ${q.text}${q.reply ? "\n   Draft reply so far: " + q.reply : ""}`).join("\n\n") + `\n\nThanks!\n${S.settings.myName || ""}`); };
};
function shareOut(title, text) { if (window.Android && Android.shareText) Android.shareText(title, text); else if (navigator.share) navigator.share({ title, text }).catch(() => {}); else copyOut(text); }

/* =====================================================================================================
   2. Journal profiles: Crossref (volume, citations, topics) + DOAJ (open access, author fee, review weeks)
   ===================================================================================================== */
const STOP = new Set("a an the of and or in on for to from with by at as is are be into its their our this that these those via between among within toward towards under over through new study case evidence approach role effect effects impact analysis research review perspective perspectives theory theoretical empirical using use based how why what when does do can across beyond after before rethinking understanding exploring examining introduction special issue editorial book reviews response reply comment".split(" "));
async function getJSON(u) { const r = await httpCall("GET", u, "", ""); if (r.status !== 200) throw new Error("HTTP " + r.status); return JSON.parse(r.text); }
XA.profile = async function (journal, force) {
  S.jprof = S.jprof || {}; const k = normJ(journal), c = S.jprof[k];
  if (c && !force && Date.now() - (c.at || 0) < 30 * 864e5) return c;
  const q = await getJSON("https://api.crossref.org/journals?rows=5&query=" + encodeURIComponent(journal.replace(/-A$/, "")));
  const items = (q.message && q.message.items) || [];
  const it = items.find(x => normJ(x.title) === k) || items.find(x => normJ(x.title).startsWith(k) || k.startsWith(normJ(x.title))) || items[0];
  if (!it) { const none = { at: Date.now(), found: false }; S.jprof[k] = none; persist(false); return none; }
  const issn = (it.ISSN || [])[0], Y = +thisYear();
  const byYear = ((it.breakdowns || {})["dois-by-issued-year"] || []).map(([y, n]) => [+y, n]).sort((a, b) => b[0] - a[0]);
  const prof = { at: Date.now(), found: true, title: it.title, publisher: it.publisher, issn: it.ISSN || [], years: byYear.filter(([y]) => y < Y && y >= Y - 5).reverse() };
  try { // citations of articles published two years back (a rough "impact" from open data)
    const w = await getJSON(`https://api.crossref.org/journals/${issn}/works?rows=200&select=is-referenced-by-count&filter=type:journal-article,from-pub-date:${Y - 2}-01-01,until-pub-date:${Y - 2}-12-31`);
    const cs = (w.message.items || []).map(x => x["is-referenced-by-count"] || 0).sort((a, b) => a - b);
    if (cs.length) { prof.citeYear = Y - 2; prof.citeN = cs.length; prof.citeMean = Math.round(cs.reduce((a, b) => a + b, 0) / cs.length * 10) / 10; prof.citeMedian = cs[cs.length >> 1]; }
  } catch (e) {}
  try { // what it published in the last 12 months: frequent title words
    const w = await getJSON(`https://api.crossref.org/journals/${issn}/works?rows=150&select=title&filter=type:journal-article,from-pub-date:${addDays(today(), -365)}`);
    const f = {}; (w.message.items || []).forEach(x => String((x.title || [])[0] || "").toLowerCase().replace(/[^a-z\- ]/g, " ").split(/\s+/).forEach(t => { if (t.length > 3 && !STOP.has(t)) f[t] = (f[t] || 0) + 1; }));
    prof.topics = Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 10).filter(([, n]) => n > 1).map(([t]) => t);
    prof.recent = (w.message.items || []).length;
  } catch (e) {}
  for (const s of prof.issn) { // DOAJ: open-access journals, their fee and review time
    try { const d = await getJSON("https://doaj.org/api/search/journals/issn%3A" + encodeURIComponent(s)); const b = d.results && d.results[0] && d.results[0].bibjson;
      if (b) { prof.doaj = true; prof.apc = b.apc && b.apc.has_apc ? (b.apc.max || []).map(x => x.currency + " " + Number(x.price).toLocaleString()).join(" / ") || "yes" : "none"; prof.weeks = b.publication_time_weeks || null; break; }
    } catch (e) {}
  }
  if (!prof.doaj) prof.doaj = false;
  S.jprof[k] = prof; persist(false); return prof;
};
const profFee = p => p.doaj ? (p.apc === "none" ? "💚 Open access, no author fee" : "💸 Open access, author fee " + p.apc) : "📖 Subscription / hybrid: free to publish (open access optional, paid)";
XA.profLine = function (journal) {
  const p = (S.jprof || {})[normJ(journal)]; if (!p || !p.found) return "";
  return `<div class="m">${p.citeMean != null ? "📈 " + p.citeMean + " cites/paper · " : ""}${p.years && p.years.length ? "🗞 ~" + p.years[p.years.length - 1][1] + "/yr · " : ""}${p.doaj ? (p.apc === "none" ? "💚 no fee" : "💸 fee") : "📖 free to publish"}</div>`;
};
XA.profileSheet = async function (journal, back) {
  openSheet(`<h3><span>ℹ ${esc(journal)}</span><button class="ghost" onclick="closeSheet()">✕</button></h3><div class="empty">Looking it up on Crossref and DOAJ…</div>`);
  let p; try { p = await XA.profile(journal); } catch (err) { return openSheet(`<h3><span>ℹ ${esc(journal)}</span><button class="ghost" onclick="closeSheet()">✕</button></h3><div class="empty">Couldn't reach Crossref (${esc(err.message)}). Check the connection and try again.</div>`); }
  const g = abdcOf(journal), mine = S.subs.filter(s => sameJournal(s.journal, journal) && isSent(s));
  const maxN = Math.max(1, ...(p.years || []).map(([, n]) => n));
  openSheet(`<h3><span>ℹ ${esc(p.title || journal)}</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${!p.found ? `<div class="empty">Not found on Crossref. It may use another name: try the journal's full title.</div>` : `
    <div class="m">${esc(p.publisher || "")}${p.issn && p.issn.length ? " · ISSN " + esc(p.issn.join(", ")) : ""}</div>
    <div style="margin:8px 0">${g ? abdcChip(g) : '<span class="chip">Not on ABDC 2025</span>'}</div>
    <dl class="kv">
      <dt>Citations</dt><dd>${p.citeMean != null ? `<b>${p.citeMean}</b> per article on average (median ${p.citeMedian}) for its ${p.citeN} articles from ${p.citeYear}` : "—"}</dd>
      <dt>Open access</dt><dd>${profFee(p)}</dd>
      ${p.weeks ? `<dt>Submission to publication</dt><dd>about ${p.weeks} weeks (DOAJ)</dd>` : ""}
      <dt>Articles a year</dt><dd>${p.years && p.years.length ? `<div style="display:flex;gap:6px;align-items:flex-end;height:54px;margin-top:4px">${p.years.map(([y, n]) => `<div style="text-align:center;font-size:11px;color:var(--muted)"><div style="width:30px;height:${Math.max(3, Math.round(40 * n / maxN))}px;background:var(--accent);border-radius:4px 4px 0 0;margin:0 auto" title="${n}"></div>${String(y).slice(2)}<br><b style="color:var(--ink)">${n}</b></div>`).join("")}</div>` : "—"}</dd>
      ${p.topics && p.topics.length ? `<dt>Recent topics</dt><dd>${p.topics.map(t => `<span class="chip" style="margin:2px">${esc(t)}</span>`).join("")}</dd>` : ""}
      <dt>Your history</dt><dd>${mine.length ? plural(mine.length, "submission") + turnaroundLine(journal, null) : "Not submitted here yet"}</dd>
    </dl>
    <div class="hint">From Crossref and DOAJ (free, open data); citations count what Crossref sees, so they run lower than Scopus or Google Scholar. Refreshed monthly.</div>`}
    <div class="actions"><button data-act="checklist" data-j="${esc(journal)}">📋 Checklist</button><button id="jprefresh">↻ Refresh</button>${back ? `<button id="jpback">← Back</button>` : ""}</div>`);
  $("#jprefresh").onclick = async () => { delete S.jprof[normJ(journal)]; XA.profileSheet(journal, back); };
  if (back && $("#jpback")) $("#jpback").onclick = back;
};
/** Shortlist side by side, to decide the order. */
XA.compareSheet = async function (pid) {
  const p = paperById(pid), list = plannedOf(pid);
  if (!list.length) return toast("Shortlist some journals first");
  openSheet(`<h3><span>⚖ Compare the shortlist</span><button class="ghost" onclick="closeSheet()">✕</button></h3><div class="empty">Looking up ${plural(list.length, "journal")}…</div>`);
  const rows = [];
  for (const s of list) { let pr = null; try { pr = await XA.profile(s.journal); } catch (e) {} rows.push([s, pr]); }
  openSheet(`<h3><span>⚖ Compare the shortlist</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="m">${esc(p.key)} · in your priority order</div>
    <div style="overflow-x:auto;margin-top:8px"><table class="cmp" style="border-collapse:collapse;font-size:13.5px;min-width:520px;width:100%">
      <tr style="text-align:left;color:var(--muted)"><th style="padding:6px">#</th><th>Journal</th><th>ABDC</th><th>Cites/paper</th><th>Articles/yr</th><th>Fee</th><th>Your history</th></tr>
      ${rows.map(([s, pr], i) => `<tr style="border-top:1px solid var(--line)"><td style="padding:6px">${i === 0 ? "⭐" : i + 1}</td><td><button class="link" data-jp="${esc(s.journal)}" style="text-align:left">${esc(s.journal)}</button></td><td>${esc(abdcOf(s.journal) || "—")}</td>
        <td>${pr && pr.citeMean != null ? pr.citeMean : "—"}</td><td>${pr && pr.years && pr.years.length ? pr.years[pr.years.length - 1][1] : "—"}</td>
        <td>${pr && pr.found ? (pr.doaj ? (pr.apc === "none" ? "none" : esc(pr.apc)) : "free*") : "—"}</td><td>${S.subs.filter(x => sameJournal(x.journal, s.journal) && isSent(x)).length || "—"}</td></tr>`).join("")}
    </table></div>
    <div class="hint">* subscription or hybrid: publishing is free; open access is optional and paid. Tap a journal for its full profile. Reorder the shortlist on the paper page.</div>
    <div class="actions"><button onclick="showPaper(paperById('${pid}'))">← Back to the paper</button></div>`);
  $("#sheet").onclick = e => { const b = e.target.closest("[data-jp]"); if (b) XA.profileSheet(b.dataset.jp, () => XA.compareSheet(pid)); };
};

/* =====================================================================================================
   3. Your Research Year: an animated recap, and an image to share
   ===================================================================================================== */
function yearData(Y) {
  const sent = S.subs.filter(s => isSent(s) && yr(s.submitted) === Y), dec = S.subs.filter(s => s.decided && yr(s.decided) === Y && s.status !== "Planned");
  const acc = dec.filter(s => s.status === "Accepted"), rej = dec.filter(s => s.status === "Rejected"), rev = dec.filter(s => s.status === "Revision requested" || s.status === "Revision resubmitted");
  const timed = dec.filter(s => s.submitted && ["Accepted", "Rejected", "Revision requested"].includes(s.status)).map(s => [s, daysBetween(s.submitted, s.decided)]).filter(([, d]) => d >= 0).sort((a, b) => a[1] - b[1]);
  const jc = {}; sent.forEach(s => jc[s.journal] = (jc[s.journal] || 0) + 1);
  const topJ = Object.entries(jc).sort((a, b) => b[1] - a[1])[0];
  const weeks = new Set(); S.subs.forEach(s => [s.submitted, s.decided].forEach(d => { if (d && yr(d) === Y) { const t = new Date(d + "T12:00:00"); weeks.add(t.getFullYear() + "-" + Math.floor((t - new Date(t.getFullYear(), 0, 1)) / 6048e5)); } }));
  const firstSent = {}; S.subs.filter(isSent).forEach(s => { if (s.submitted && (!firstSent[s.paper] || s.submitted < firstSent[s.paper])) firstSent[s.paper] = s.submitted; });
  const newPapers = Object.entries(firstSent).filter(([, d]) => yr(d) === Y).map(([p]) => paperById(p)).filter(Boolean);
  const reviews = recList("review").filter(r => r.status === "Submitted" && yr(r.done || r.due) === Y);
  const kinds = {}; sent.forEach(s => { const k = subKind(s); kinds[k] = (kinds[k] || 0) + 1; });
  return { Y, sent, dec, acc, rej, rev, fastest: timed[0], slowest: timed[timed.length - 1], topJ, weeks: weeks.size, newPapers, reviews, kinds,
    stillOut: S.subs.filter(s => isOpen(s) && s.submitted && s.submitted <= Y + "-12-31").length };
}
XA.yearSlides = function (d) {
  const sl = [];
  sl.push({ big: d.Y, title: "Your Research Year", sub: "RD SK · tap to continue", fx: "confetti" });
  sl.push({ big: d.sent.length, title: plural(d.sent.length, "submission") + " sent", sub: Object.entries(d.kinds).map(([k, n]) => (KIND[k].icon || "📄") + " " + n + " " + (k === "journal" ? "to journals" : KIND[k].plural)).join(" · ") || "Every one counts", fx: "plane" });
  if (d.newPapers.length) sl.push({ big: d.newPapers.length, title: plural(d.newPapers.length, "new paper") + " out in the world", sub: d.newPapers.slice(0, 4).map(p => p.key).join(" · ") });
  sl.push({ big: d.acc.length, title: d.acc.length ? plural(d.acc.length, "acceptance") + " 🏆" : "Acceptances are coming", sub: d.acc.length ? d.acc.slice(0, 4).map(s => s.journal).join(" · ") : d.stillOut + " still under review", fx: d.acc.length ? "fireworks" : "" });
  if (d.rev.length) sl.push({ big: d.rev.length, title: plural(d.rev.length, "revise & resubmit"), sub: "Each one is a door left open" });
  sl.push({ big: d.rej.length, title: plural(d.rej.length, "rejection") + ", survived", sub: d.rej.length ? "Every rejection made the next version better 💪" : "A clean sheet" });
  if (d.fastest) sl.push({ big: d.fastest[1], title: "days: your fastest decision", sub: d.fastest[0].journal + " · " + statusText(d.fastest[0].status, subKind(d.fastest[0])) });
  if (d.slowest && d.slowest !== d.fastest) sl.push({ big: d.slowest[1], title: "days: the longest wait", sub: d.slowest[0].journal });
  if (d.topJ && d.topJ[1] > 1) sl.push({ big: d.topJ[1], title: "times to " + d.topJ[0], sub: "Your most-tried journal" });
  if (d.reviews.length) sl.push({ big: d.reviews.length, title: plural(d.reviews.length, "review") + " written for others", sub: "Good academic citizenship ✨" });
  sl.push({ big: d.weeks, title: "active weeks", sub: "Weeks you sent, heard back or recorded something", fx: "embers" });
  sl.push({ big: "🎉", title: "That was " + d.Y, sub: "Save the card to share it", last: true, fx: "confetti" });
  return sl;
};
XA.year = function (Y) {
  Y = Y || (new Date().getMonth() < 1 ? String(+thisYear() - 1) : thisYear());
  const d = yearData(Y), slides = XA.yearSlides(d); let i = 0;
  const years = [...new Set(S.subs.map(s => yr(s.submitted)).filter(Boolean))].sort().reverse();
  const ov = document.createElement("div"); ov.id = "yr";
  ov.style.cssText = "position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;padding:24px;background:linear-gradient(160deg,#1d3557,#2f5d8a 45%,#7b2cbf);transition:background 1s;user-select:none";
  const BG = ["linear-gradient(160deg,#1d3557,#2f5d8a 45%,#7b2cbf)", "linear-gradient(160deg,#0b525b,#14746f 50%,#99d98c)", "linear-gradient(160deg,#370617,#9d0208 50%,#f48c06)", "linear-gradient(160deg,#10002b,#5a189a 50%,#e0aaff)", "linear-gradient(160deg,#03045e,#0077b6 50%,#90e0ef)", "linear-gradient(160deg,#3c1642,#086375 50%,#1dd3b0)"];
  const show = () => {
    const s = slides[i]; ov.style.background = BG[i % BG.length];
    ov.innerHTML = `<div style="position:absolute;top:14px;left:14px;right:14px;display:flex;gap:4px">${slides.map((_, k) => `<i style="flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,${k <= i ? .95 : .3})"></i>`).join("")}</div>
      <button id="yrx" style="position:absolute;top:26px;right:14px;background:none;border:0;color:#fff;font-size:26px">✕</button>
      <div class="yrin" style="max-width:520px;animation:yrpop .6s cubic-bezier(.2,1.4,.4,1)">
        <div style="font-size:${String(s.big).length > 4 ? 64 : 104}px;font-weight:800;line-height:1;letter-spacing:-2px" id="yrbig">${typeof s.big === "number" ? 0 : esc(String(s.big))}</div>
        <div style="font-size:24px;font-weight:700;margin-top:14px">${esc(s.title)}</div>
        <div style="font-size:16px;opacity:.85;margin-top:10px">${esc(s.sub || "")}</div>
        ${s.last ? `<div style="margin-top:26px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button id="yrsave" style="background:#fff;color:#2f5d8a;border:0;border-radius:24px;padding:12px 20px;font-weight:700">🖼 Save the card</button>
          ${years.length > 1 ? `<select id="yrpick" style="border-radius:24px;padding:10px 14px;border:0;width:auto">${years.map(y => `<option ${y === Y ? "selected" : ""}>${y}</option>`).join("")}</select>` : ""}</div>` : ""}
      </div>`;
    if (typeof s.big === "number") { const el = ov.querySelector("#yrbig"), t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(s.big * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
    if (s.fx === "confetti") FX.confetti(140); else if (s.fx === "fireworks" && FX.fireworks) FX.fireworks(); else if (s.fx === "plane") FX.submitted("", innerWidth / 2, innerHeight * .7); else if (s.fx === "embers" && FX.embers) FX.embers();
    ov.querySelector("#yrx").onclick = e => { e.stopPropagation(); ov.remove(); };
    const sv = ov.querySelector("#yrsave"); if (sv) sv.onclick = e => { e.stopPropagation(); XA.yearCard(d); };
    const yp = ov.querySelector("#yrpick"); if (yp) { yp.onclick = e => e.stopPropagation(); yp.onchange = () => { ov.remove(); XA.year(yp.value); }; }
  };
  ov.onclick = e => { if (e.clientX < innerWidth / 3) i = Math.max(0, i - 1); else if (i < slides.length - 1) i++; else return; show(); };
  if (!document.getElementById("yrcss")) { const st = document.createElement("style"); st.id = "yrcss"; st.textContent = "@keyframes yrpop{from{transform:scale(.6) translateY(30px);opacity:0}to{transform:none;opacity:1}}"; document.head.appendChild(st); }
  document.body.appendChild(ov); show();
};
/** A 1080×1350 image of the year, saved to Downloads (phone) or downloaded (web). */
XA.yearCard = function (d) {
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350; const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 1080, 1350); gr.addColorStop(0, "#1d3557"); gr.addColorStop(.5, "#2f5d8a"); gr.addColorStop(1, "#7b2cbf"); g.fillStyle = gr; g.fillRect(0, 0, 1080, 1350);
  for (let k = 0; k < 90; k++) { g.fillStyle = `hsla(${k * 37 % 360},90%,70%,.55)`; g.fillRect((k * 173) % 1080, (k * 97) % 1350, 10, 18); }
  g.fillStyle = "#fff"; g.textAlign = "left"; g.font = "700 46px system-ui,sans-serif"; g.fillText("My Research Year", 80, 140);
  g.font = "800 150px system-ui,sans-serif"; g.fillText(d.Y, 74, 290);
  const tiles = [[d.sent.length, "submissions sent"], [d.acc.length, "acceptances"], [d.rev.length, "revise & resubmits"], [d.rej.length, "rejections survived"],
    [d.newPapers.length, "new papers out"], [d.reviews.length, "reviews written"]];
  tiles.forEach(([n, l], k) => { const x = 80 + (k % 2) * 470, y = 360 + Math.floor(k / 2) * 230;
    g.fillStyle = "rgba(255,255,255,.14)"; g.beginPath(); (g.roundRect ? g.roundRect(x, y, 440, 200, 28) : g.rect(x, y, 440, 200)); g.fill();
    g.fillStyle = "#fff"; g.font = "800 96px system-ui,sans-serif"; g.fillText(String(n), x + 34, y + 112); g.font = "500 34px system-ui,sans-serif"; g.fillText(l, x + 34, y + 165); });
  g.font = "500 32px system-ui,sans-serif"; g.fillStyle = "rgba(255,255,255,.9)";
  const line = d.fastest ? `Fastest decision: ${d.fastest[1]} days (${d.fastest[0].journal})` : d.weeks + " active weeks";
  g.fillText(line.length > 52 ? line.slice(0, 50) + "…" : line, 80, 1110);
  g.font = "600 30px system-ui,sans-serif"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText("Tracked with RD SK", 80, 1270);
  const data = c.toDataURL("image/png"), name = "RD-SK-research-year-" + d.Y + ".png";
  if (window.Android && Android.saveFile) saveFile(name, data.split(",")[1], "image/png", true);
  else { const a = document.createElement("a"); a.href = data; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast("Image saved"); }
};

/* =====================================================================================================
   4. Calls for papers: special issues, conferences, edited books, grant calls, with deadlines
   ===================================================================================================== */
const CALL_KINDS = ["Special issue", "Conference", "Edited book", "Grant / fellowship", "Other"];
const CALL_ST = ["Watching", "Planning to submit", "Submitted", "Skipped"];
const callsLive = () => recList("call").filter(c => c.status !== "Skipped" && c.status !== "Submitted");
XA.calls = function () {
  const all = recList("call").sort((a, b) => ((a.status === "Skipped" || a.status === "Submitted") - (b.status === "Skipped" || b.status === "Submitted")) || (a.deadline || "9").localeCompare(b.deadline || "9"));
  openSheet(`<h3><span>📣 Calls for papers</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="actions" style="margin-top:0"><button class="primary" data-cadd>+ Add a call</button><button data-cpaste>📋 From a pasted call${xaGeminiKey() ? " (AI)" : ""}</button></div>
    ${all.length ? all.map(c => { const old = c.status === "Skipped" || c.status === "Submitted" || (c.deadline && daysTo(c.deadline) < 0);
      return `<div class="card tap" data-cedit="${c.id}" style="${old ? "opacity:.6" : ""}"><div class="row"><div class="grow"><div class="t">${esc(c.title || "Untitled call")}</div>
        <div class="m">${esc(c.kind || "")}${c.venue ? " · " + esc(c.venue) : ""}</div>
        <div style="margin-top:5px">${c.deadline ? countdown(c.deadline) + ` <span class="m">deadline ${fmt(c.deadline)}</span>` : '<span class="m">no deadline set</span>'} <span class="chip">${esc(c.status || "Watching")}</span></div>
        ${c.paper ? `<div class="m" style="margin-top:4px">📄 ${esc((paperById(c.paper) || {}).key || "")}</div>` : ""}</div></div></div>`; }).join("") : `<div class="empty">Save special issues, conference calls, edited-book calls and grant calls here: RD SK counts down to each deadline and reminds you two weeks, three days and one day before.</div>`}`);
  $("#sheet").onclick = e => { const t = e.target.closest("[data-cadd],[data-cpaste],[data-cedit]"); if (!t) return;
    if (t.dataset.cadd != null) XA.callEdit(null); else if (t.dataset.cpaste != null) XA.callPaste(); else XA.callEdit(recGet("call", t.dataset.cedit)); };
};
XA.callEdit = function (c, pre) {
  const isNew = !c; c = c || Object.assign({ title: "", kind: "Special issue", venue: "", deadline: "", link: "", notes: "", status: "Watching", paper: "" }, pre || {});
  const papers = S.papers.slice().sort((a, b) => a.key.localeCompare(b.key));
  openSheet(`<h3><span>${isNew ? "New call" : "Call for papers"}</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${lbl("Title", "ct")}<input id="ct" value="${esc(c.title)}" placeholder="e.g. Special issue: Algorithms and organizing">
    <div class="two"><div>${lbl("Kind", "ck")}<select id="ck">${CALL_KINDS.map(k => `<option ${k === c.kind ? "selected" : ""}>${k}</option>`).join("")}</select></div>
    <div>${lbl("Deadline", "cd")}<input type="date" id="cd" value="${esc(c.deadline)}"></div></div>
    ${lbl("Journal / conference / book / funder", "cv")}<input id="cv" value="${esc(c.venue)}" autocomplete="off">
    ${lbl("Link", "cl")}<input id="cl" type="url" value="${esc(c.link)}" placeholder="https://…">
    <div class="two"><div>${lbl("Status", "cs")}<select id="cs">${CALL_ST.map(k => `<option ${k === c.status ? "selected" : ""}>${k}</option>`).join("")}</select></div>
    <div>${lbl("For which paper?", "cp")}<select id="cp"><option value="">—</option>${papers.map(p => `<option value="${p.id}" ${p.id === c.paper ? "selected" : ""}>${esc(p.key)}</option>`).join("")}</select></div></div>
    ${lbl("Notes", "cn")}<textarea id="cn" placeholder="themes, word limit, guest editors, abstract first?">${esc(c.notes)}</textarea>
    <div class="actions"><button class="primary" id="csave">Save</button>${c.link ? `<button id="copen">Open call ↗</button>` : ""}<button id="cmatch">📄 Shortlist for the paper</button>${window.XB && c.deadline ? XB.calBtn("📣 Deadline: " + (c.title || c.venue), c.deadline, [c.venue, c.link].filter(Boolean).join("\n")) : ""}${isNew ? "" : `<button class="danger" id="cdel">Delete</button>`}<button data-xback="calls">← All calls</button></div>`);
  journalPicker($("#cv"));
  const read = () => Object.assign(c, { title: $("#ct").value.trim(), kind: $("#ck").value, deadline: $("#cd").value, venue: $("#cv").value.trim(), link: $("#cl").value.trim(), status: $("#cs").value, paper: $("#cp").value, notes: $("#cn").value.trim() });
  $("#csave").onclick = () => { read(); if (!c.title && !c.venue) return toast("Add a title or the journal"); recPut("call", c); render(); XA.calls(); toast("Saved"); };
  if ($("#copen")) $("#copen").onclick = () => openBrowser(c.link);
  $("#cmatch").onclick = () => { read(); if (!c.paper) return toast("Choose the paper first"); if (!c.venue) return toast("Add the journal or conference");
    if (c.status === "Watching") c.status = "Planning to submit"; recPut("call", c);
    shortlistAdd(c.paper, c.venue, "Call: " + (c.title || c.kind) + (c.deadline ? ", deadline " + fmt(c.deadline) : ""), true); render(); toast("⭐ Next for " + (paperById(c.paper) || {}).key + ": " + c.venue); XA.calls(); };
  if ($("#cdel")) $("#cdel").onclick = () => { if (confirm("Delete this call?")) { recDel("call", c.id); render(); XA.calls(); } };
};
/** Reads a pasted call: Gemini when you have a key, otherwise the first line and the first date in the text. */
XA.callPaste = async function () {
  let t = (window.Android && Android.getClipboard) ? Android.getClipboard() : "";
  if (!t && navigator.clipboard) try { t = await navigator.clipboard.readText(); } catch (e) {}
  t = prompt("Paste the call for papers (text or its main parts):", t || "") || ""; if (!t.trim()) return;
  const guess = { title: (t.split("\n").map(x => x.trim()).find(x => x.length > 10) || "").slice(0, 140), notes: t.slice(0, 1500), link: (t.match(/https?:\/\/\S+/) || [""])[0].replace(/[).,]+$/, "") };
  const dm = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)/i) || t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)/i);
  const M = m => "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m.slice(0, 3).toLowerCase()) / 3 + 1;
  if (dm) { const [d, m, y] = /^\d/.test(dm[1]) ? [dm[1], dm[2], dm[3]] : [dm[2], dm[1], dm[3]]; guess.deadline = y + "-" + String(M(m)).padStart(2, "0") + "-" + String(d).padStart(2, "0"); }
  const vm = t.match(/^\s*(?:journal|conference|venue|publication|book|funder)\s*:\s*(.+)$/im); if (vm) guess.venue = vm[1].trim().slice(0, 120);
  const si = t.match(/special issue\s*(?:on|:)\s*[“"']?([^\n“”"]+)/i); if (si && !vm) guess.title = "Special issue: " + si[1].trim();
  if (/conference|congress|annual meeting|symposium|workshop/i.test(t)) guess.kind = "Conference"; else if (/edited (volume|book|collection)|book chapter/i.test(t)) guess.kind = "Edited book"; else if (/grant|fellowship|funding/i.test(t)) guess.kind = "Grant / fellowship";
  if (xaGeminiKey()) {
    toast("Reading the call with Gemini…");
    try { const a = await geminiAsk(xaGeminiKey(), `Extract from this call for papers a JSON object {"title":"","kind":"Special issue|Conference|Edited book|Grant / fellowship|Other","venue":"journal/conference/book/funder name","deadline":"YYYY-MM-DD (the main submission deadline; full paper if both)","link":"","summary":"2 sentences on the themes and requirements"}. Return only JSON.\n\n${t.slice(0, 8000)}`);
      const m = (a.text || "").match(/\{[\s\S]*\}/); if (m) { const j = JSON.parse(m[0]); ["title", "venue", "link"].forEach(k => { if (j[k]) guess[k] = j[k]; }); if (/^\d{4}-\d\d-\d\d$/.test(j.deadline || "")) guess.deadline = j.deadline; if (CALL_KINDS.includes(j.kind)) guess.kind = j.kind; if (j.summary) guess.notes = j.summary + "\n\n" + guess.notes.slice(0, 1000); }
    } catch (e) { toast("Gemini couldn't read it: filled in what RD SK could"); }
  }
  XA.callEdit(null, guess);
};

/* =====================================================================================================
   5. Publications, CV list and yearly report
   ===================================================================================================== */
function published() {
  return S.papers.map(p => { const acc = subsOf(p.id).filter(s => s.status === "Accepted").sort((a, b) => (b.decided || "").localeCompare(a.decided || ""))[0];
    return (acc || p.override === "Published") ? { p, acc } : null; }).filter(Boolean);
}
async function crossrefWork(doi) {
  S.cref = S.cref || {}; const c = S.cref[doi]; if (c && Date.now() - c.at < 7 * 864e5) return c;
  const j = await getJSON("https://api.crossref.org/works/" + encodeURIComponent(doi)); const m = j.message || {};
  const w = { at: Date.now(), title: (m.title || [])[0] || "", journal: (m["container-title"] || [])[0] || "", year: ((m.issued || {})["date-parts"] || [[]])[0][0] || "",
    volume: m.volume || "", issue: m.issue || "", pages: m.page || m["article-number"] || "", cites: m["is-referenced-by-count"] || 0, type: m.type || "",
    authors: (m.author || []).map(a => ({ family: a.family || a.name || "", given: a.given || "" })), publisher: m.publisher || "" };
  S.cref[doi] = w; persist(false); return w;
}
const initials = g => (g || "").split(/[\s-]+/).filter(Boolean).map(x => x[0].toUpperCase() + ".").join(" ");
function authorsFrom(p, w) {
  if (w && w.authors && w.authors.length) return w.authors;
  return (p.authors || "").split(/;|,(?=\s*[A-Z][a-z]+,)|\s+and\s+|\s*&\s*/).map(x => x.trim()).filter(Boolean).map(x => { const [f, g] = x.split(",").map(y => (y || "").trim()); return { family: f, given: g || "" }; });
}
function apaAuthors(list) {
  const a = list.map(x => x.family + (x.given ? ", " + initials(x.given) : ""));
  return a.length <= 1 ? a.join("") : a.length === 2 ? a[0] + ", & " + a[1] : a.slice(0, -1).join(", ") + ", & " + a[a.length - 1];
}
function harvardAuthors(list) {
  const a = list.map(x => x.family + (x.given ? ", " + initials(x.given).replace(/\s/g, "") : ""));
  return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}
function cite(style, e) {
  const { p, acc } = e, w = p.doi && (S.cref || {})[p.doi], k = kindOf(p), list = authorsFrom(p, w);
  const year = (w && w.year) || (acc && yr(acc.decided)) || "in press", title = (w && w.title) || p.title || p.key, venue = (w && w.journal) || (acc && acc.journal) || "";
  const inPress = !(w && w.year) && !p.doi, vol = w && w.volume ? w.volume + (w.issue ? "(" + w.issue + ")" : "") : "", pages = w && w.pages ? w.pages : "";
  const doi = p.doi ? " https://doi.org/" + p.doi : "", what = { conf: "Paper presented at ", chapter: "In ", grant: "Grant awarded by " }[k] || "";
  if (style === "apa") return `${apaAuthors(list)} (${inPress ? "in press" : year}). ${title}. ${what}${venue ? `*${venue}*` : ""}${vol ? ", *" + vol.replace(/\(.*/, "") + "*" + (vol.match(/\(.*\)/) || [""])[0] : ""}${pages ? ", " + pages : ""}.${doi}`;
  return `${harvardAuthors(list)} (${inPress ? "forthcoming" : year}) '${title}', ${what}${venue ? `*${venue}*` : ""}${vol ? ", " + vol : ""}${pages ? ", pp. " + pages : ""}.${p.doi ? " doi:" + p.doi : ""}`;
}
XA.pubs = function (style) {
  style = style || S.settings.citeStyle || "apa"; S.settings.citeStyle = style;
  const when = e => (e.acc && e.acc.decided) || String(((e.p.doi && (S.cref || {})[e.p.doi]) || {}).year || "");
  const list = published().sort((a, b) => when(b).localeCompare(when(a)));
  const total = list.reduce((n, e) => n + ((e.p.doi && (S.cref || {})[e.p.doi] || {}).cites || 0), 0);
  openSheet(`<h3><span>🧾 Publications &amp; CV</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="filters"><button data-cst="apa" class="${style === "apa" ? "on" : ""}">APA 7</button><button data-cst="harvard" class="${style === "harvard" ? "on" : ""}">Harvard</button></div>
    <div class="m">${plural(list.length, "accepted or published work")}${total ? " · " + plural(total, "citation") + " (Crossref)" : ""}</div>
    ${list.length ? list.map(e => { const w = e.p.doi && (S.cref || {})[e.p.doi]; return `<div class="card"><div style="font-size:14.5px;line-height:1.5">${esc(cite(style, e)).replace(/\*([^*]+)\*/g, "<i>$1</i>")}</div>
      <div class="actions" style="margin-top:6px">${e.p.doi ? `<span class="m">${w ? "📈 " + plural(w.cites, "citation") : ""}</span><button class="link" data-act="doi" data-doi="${esc(e.p.doi)}">DOI ↗</button>` : `<button data-doif="${e.p.id}">🔎 Find DOI</button>`}<button class="link" data-doiset="${e.p.id}">${e.p.doi ? "Edit DOI" : "Type DOI"}</button></div></div>`; }).join("")
      : `<div class="empty">Accepted papers, chapters, books and talks appear here, ready to copy into your CV.</div>`}
    ${window.XB ? `<div class="actions" style="margin-top:0"><button data-act="xb" data-x="addpubs">📚 Add earlier publications (DOI / ORCID)</button><button data-act="xb" data-x="cites">📈 Citations</button>${S.settings.scholar ? `<button data-gs>Google Scholar ↗</button>` : ""}</div>` : ""}
    <div class="actions"><button class="primary" data-pcopy>Copy list</button><button data-pshare>Share…</button><button data-prefresh>↻ Update citations</button><button data-preport>📊 Yearly report</button></div>
    <div class="hint">Details (volume, pages, citations) come from Crossref once a paper has a DOI; until then it is listed as in press.</div>`);
  const text = () => list.map(e => cite(style, e).replace(/\*/g, "")).join("\n\n");
  $("#sheet").onclick = async e => {
    const t = e.target.closest("button"); if (!t) return; const d = t.dataset;
    if (d.cst) { S.settings.citeStyle = d.cst; persist(false); return XA.pubs(d.cst); }
    if (d.pcopy != null) return copyOut(text());
    if (d.gs != null) return openBrowser(S.settings.scholar);
    if (d.pshare != null) return shareOut("Publications", text());
    if (d.preport != null) return XA.report();
    if (d.prefresh != null) { toast("Updating from Crossref…"); for (const x of list) if (x.p.doi) { delete (S.cref || {})[x.p.doi]; try { await crossrefWork(x.p.doi); } catch (err) {} } return XA.pubs(style); }
    if (d.doiset) { const p = paperById(d.doiset), v = prompt("DOI (e.g. 10.1177/0170840626…)", p.doi || ""); if (v == null) return; p.doi = v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""); persist(); if (p.doi) try { await crossrefWork(p.doi); } catch (err) { toast("Crossref didn't know that DOI"); } return XA.pubs(style); }
    if (d.doif) { const p = paperById(d.doif), e2 = list.find(x => x.p.id === p.id); toast("Searching Crossref…");
      try { const j = await getJSON("https://api.crossref.org/works?rows=3&select=DOI,title,container-title,issued&query.bibliographic=" + encodeURIComponent((p.title || p.key) + " " + ((e2.acc || {}).journal || "")));
        const hit = (j.message.items || []).find(x => normJ((x.title || [])[0]).slice(0, 40) === normJ(p.title || p.key).slice(0, 40)) || (j.message.items || [])[0];
        if (!hit) return toast("Not on Crossref yet");
        if (confirm(`Is this it?\n\n${(hit.title || [])[0]}\n${(hit["container-title"] || [])[0] || ""}\nDOI ${hit.DOI}`)) { p.doi = hit.DOI; persist(); await crossrefWork(p.doi); XA.pubs(style); }
      } catch (err) { toast("Couldn't reach Crossref"); } }
  };
};
XA.reportText = function () {
  const years = [...new Set(S.subs.map(s => yr(s.submitted)).concat(S.subs.map(s => yr(s.decided))).filter(Boolean))].sort().reverse();
  const rows = years.map(Y => { const d = yearData(Y), g = {}; d.acc.forEach(s => { const a = abdcOf(s.journal); if (a) g[a] = (g[a] || 0) + 1; });
    return { Y, sent: d.sent.length, acc: d.acc.length, rej: d.rej.length, rev: d.rev.length, abdc: ["A*", "A", "B", "C"].filter(k => g[k]).map(k => g[k] + "×" + k).join(", "), reviews: d.reviews.length,
      conf: d.acc.filter(s => subKind(s) === "conf").length, grants: d.acc.filter(s => subKind(s) === "grant").length }; });
  return { rows, csv: "Year,Submissions,Accepted,Rejected,Revise & resubmit,Accepted by ABDC grade,Reviews done,Conference acceptances,Grants awarded\n" + rows.map(r => [r.Y, r.sent, r.acc, r.rej, r.rev, '"' + r.abdc + '"', r.reviews, r.conf, r.grants].join(",")).join("\n") };
};
XA.report = function () {
  const { rows, csv } = XA.reportText();
  openSheet(`<h3><span>📊 Yearly report</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13.5px;min-width:560px;width:100%"><tr style="text-align:left;color:var(--muted)"><th style="padding:6px">Year</th><th>Sent</th><th>Accepted</th><th>Rejected</th><th>R&amp;R</th><th>ABDC (accepted)</th><th>Reviews</th><th>Conf.</th><th>Grants</th></tr>
    ${rows.map(r => `<tr style="border-top:1px solid var(--line)"><td style="padding:6px"><b>${r.Y}</b></td><td>${r.sent}</td><td>${r.acc}</td><td>${r.rej}</td><td>${r.rev}</td><td>${esc(r.abdc || "—")}</td><td>${r.reviews}</td><td>${r.conf}</td><td>${r.grants}</td></tr>`).join("")}</table></div>
    <div class="hint">For appraisal and promotion files. Years follow submission and decision dates.</div>
    <div class="actions"><button class="primary" id="rpcsv">Save as spreadsheet (.csv)</button><button id="rpcopy">Copy</button><button data-xback="pubs">← Publications</button></div>`);
  $("#rpcsv").onclick = () => saveFile("RD-SK-yearly-report-" + today() + ".csv", csv, "text/csv");
  $("#rpcopy").onclick = () => copyOut(csv.replace(/,/g, "\t").replace(/"/g, ""));
};

/* =====================================================================================================
   6. Reviewing for journals
   ===================================================================================================== */
const REV_ST = ["Invited", "Accepted", "Submitted", "Declined"];
XA.reviews = function () {
  const all = recList("review").sort((a, b) => (["Accepted", "Invited"].includes(b.status) - ["Accepted", "Invited"].includes(a.status)) || (a.due || "9").localeCompare(b.due || "9"));
  const Y = thisYear(), doneY = all.filter(r => r.status === "Submitted" && yr(r.done || r.due) === Y).length;
  openSheet(`<h3><span>🧑‍⚖️ Reviewing</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><b>${all.filter(r => r.status === "Accepted").length}</b><span>In progress</span></div><div class="tile"><b>${doneY}</b><span>Done in ${Y}</span></div><div class="tile"><b>${all.filter(r => r.status === "Submitted").length}</b><span>All time</span></div></div>
    <div class="actions"><button class="primary" data-radd>+ Add a review invitation</button></div>
    ${all.length ? all.map(r => `<div class="card tap" data-redit="${r.id}" style="${["Submitted", "Declined"].includes(r.status) ? "opacity:.65" : ""}"><div class="t">${esc(r.journal || "Journal")}${abdcChip(abdcOf(r.journal || ""))}</div>
      <div class="m">${esc(r.title || r.msid || "Manuscript")}${r.round > 1 ? " · round " + r.round : ""}</div>
      <div style="margin-top:5px"><span class="chip">${esc(r.status)}</span> ${r.status === "Accepted" && r.due ? countdown(r.due) + ` <span class="m">due ${fmt(r.due)}</span>` : r.status === "Submitted" ? `<span class="m">sent ${fmt(r.done)}</span>` : r.status === "Invited" && r.invited ? `<span class="m">invited ${fmt(r.invited)}</span>` : ""}</div></div>`).join("")
      : `<div class="empty">Keep the reviews you do for journals: due dates with reminders, and a yearly count for appraisals.</div>`}`);
  $("#sheet").onclick = e => { const t = e.target.closest("[data-radd],[data-redit]"); if (!t) return; XA.reviewEdit(t.dataset.redit ? recGet("review", t.dataset.redit) : null); };
};
XA.reviewEdit = function (r) {
  const isNew = !r; r = r || { journal: "", title: "", msid: "", invited: today(), due: addDays(today(), 28), status: "Accepted", done: "", round: 1, notes: "", link: "" };
  openSheet(`<h3><span>${isNew ? "New review" : "Review"}</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${lbl("Journal", "rj")}<input id="rj" value="${esc(r.journal)}" autocomplete="off">
    <div class="two"><div>${lbl("Manuscript ID", "rm")}<input id="rm" value="${esc(r.msid)}"></div><div>${lbl("Round", "rr")}<input id="rr" type="number" min="1" value="${esc(r.round || 1)}"></div></div>
    ${lbl("Manuscript title (optional)", "rt")}<input id="rt" value="${esc(r.title)}">
    <div class="two"><div>${lbl("Status", "rs")}<select id="rs">${REV_ST.map(k => `<option ${k === r.status ? "selected" : ""}>${k}</option>`).join("")}</select></div><div>${lbl("Invited on", "ri")}<input type="date" id="ri" value="${esc(r.invited)}"></div></div>
    <div class="two"><div>${lbl("Due", "rd")}<input type="date" id="rd" value="${esc(r.due)}"></div><div>${lbl("Review sent on", "rx")}<input type="date" id="rx" value="${esc(r.done)}"></div></div>
    ${lbl("Reviewer site link", "rl")}<input id="rl" type="url" value="${esc(r.link || "")}" placeholder="the journal's reviewer centre">
    ${lbl("Notes", "rn")}<textarea id="rn">${esc(r.notes)}</textarea>
    <div class="actions"><button class="primary" id="rsave">Save</button>${r.link ? `<button id="ropen">Open site ↗</button>` : ""}${window.XB && r.due && !isNew ? XB.calBtn("🧑‍⚖️ Review due: " + r.journal, r.due, r.msid || "") : ""}${isNew ? "" : `<button class="danger" id="rdel">Delete</button>`}<button data-xback="reviews">← All reviews</button></div>`);
  journalPicker($("#rj"));
  $("#rs").onchange = () => { if ($("#rs").value === "Submitted" && !$("#rx").value) $("#rx").value = today(); };
  $("#rsave").onclick = () => { Object.assign(r, { journal: $("#rj").value.trim(), msid: $("#rm").value.trim(), round: +$("#rr").value || 1, title: $("#rt").value.trim(), status: $("#rs").value, invited: $("#ri").value, due: $("#rd").value, done: $("#rx").value, link: $("#rl").value.trim(), notes: $("#rn").value.trim() });
    if (!r.journal) return toast("Add the journal"); const was = isNew ? "" : (recGet("review", r.id) || {}).status;
    recPut("review", r); render(); XA.reviews(); if (r.status === "Submitted" && was !== "Submitted") FX.confetti(70); toast("Saved"); };
  if ($("#ropen")) $("#ropen").onclick = () => openBrowser(r.link);
  if ($("#rdel")) $("#rdel").onclick = () => { if (confirm("Delete this review?")) { recDel("review", r.id); render(); XA.reviews(); } };
};

/* =====================================================================================================
   7. Goals, shown as rings on Home
   ===================================================================================================== */
const GOALS = { sent: "Submissions sent", newp: "New papers sent out", acc: "Acceptances", rev: "Revisions resubmitted", reviews: "Reviews written", conf: "Conference papers submitted", grant: "Grant applications" };
function goalCount(g) {
  const Y = g.year || thisYear(), d = yearData(Y);
  return { sent: d.sent.length, newp: d.newPapers.length, acc: d.acc.length, rev: S.subs.filter(s => s.status === "Revision resubmitted" && yr(s.decided) === Y).length + S.subs.filter(s => /revised version/i.test(s.notes || "") && yr(s.submitted) === Y).length,
    reviews: d.reviews.length, conf: d.sent.filter(s => subKind(s) === "conf").length, grant: d.sent.filter(s => subKind(s) === "grant").length }[g.metric] || 0;
}
function goalPace(g) { const Y = +(g.year || thisYear()), start = new Date(Y, 0, 1), end = new Date(Y + 1, 0, 1), now = Math.min(Math.max(Date.now(), +start), +end); return g.target * (now - start) / (end - start); }
function ring(pct, col, label, n, t) {
  const r = 30, C = 2 * Math.PI * r, off = C * (1 - Math.min(1, pct));
  return `<div style="text-align:center;min-width:92px"><svg width="76" height="76" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/>
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 38 38)" style="transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)" data-ring="${off}"/>
    <text x="38" y="43" text-anchor="middle" style="font:700 16px system-ui;fill:var(--ink)">${n}/${t}</text></svg><div class="m" style="font-size:12px;line-height:1.25">${esc(label)}</div></div>`;
}
XA.goalsHome = function () {
  const gs = recList("goal").filter(g => (g.year || thisYear()) === thisYear()); if (!gs.length) return "";
  let nudge = "";
  const rings = gs.map(g => { const n = goalCount(g), pct = g.target ? n / g.target : 0, pace = goalPace(g), behind = n + 0.5 < pace && n < g.target;
    if (behind && !nudge) { const need = Math.max(1, Math.round(pace) - n), wk = Math.max(1, Math.round((new Date(+(g.year || thisYear()) + 1, 0, 1) - Date.now()) / 6048e5));
      nudge = `${GOALS[g.metric]}: ${n} of ${g.target}, ${need === 1 ? "one" : need} behind the pace for the date (${g.target - n} to go in ${plural(wk, "week")}).`; }
    return ring(pct, n >= g.target ? "var(--acc)" : behind ? "var(--warn)" : "var(--accent)", GOALS[g.metric], n, g.target); }).join("");
  setTimeout(() => document.querySelectorAll("[data-ring]").forEach(c => c.style.strokeDashoffset = c.dataset.ring), 60);
  return `<button class="card tap wide" data-act="xa" data-x="goals" style="width:100%;text-align:left;font:inherit;color:inherit;margin-top:8px"><div class="row"><div class="t grow">🎯 ${thisYear()} goals</div><span class="m">edit →</span></div>
    <div style="display:flex;gap:8px;overflow-x:auto;padding:6px 0">${rings}</div>${nudge ? `<div class="m" style="color:var(--warn)">⏰ ${esc(nudge)}</div>` : ""}</button>`;
};
XA.goals = function () {
  const Y = thisYear(), gs = recList("goal").filter(g => (g.year || Y) === Y);
  openSheet(`<h3><span>🎯 Goals for ${Y}</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${gs.map(g => `<div class="card"><div class="row"><div class="grow"><div class="t">${esc(GOALS[g.metric])}</div><div class="m">${goalCount(g)} of ${g.target} so far</div></div>
      <input type="number" min="1" data-gt="${g.id}" value="${g.target}" style="width:80px"><button class="ghost" data-gdel="${g.id}">✕</button></div></div>`).join("") || `<div class="empty">Set a few targets for the year: they show as rings on Home, with a nudge when you fall behind the pace.</div>`}
    <h2>Add a goal</h2>
    <div class="two"><div><select id="gm">${Object.entries(GOALS).filter(([k]) => !gs.some(g => g.metric === k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div><input id="gn" type="number" min="1" value="4"></div></div>
    <div class="actions"><button class="primary" id="gadd">Add goal</button></div>`);
  $("#gadd").onclick = () => { const m = $("#gm").value, n = +$("#gn").value; if (!m || !(n > 0)) return toast("Pick a goal and a number"); recPut("goal", { metric: m, target: n, year: Y }); render(); XA.goals(); };
  $("#sheet").onchange = e => { const id = e.target.dataset.gt; if (id) { const g = recGet("goal", id); g.target = Math.max(1, +e.target.value || 1); recPut("goal", g); render(); toast("Saved"); } };
  $("#sheet").onclick = e => { const b = e.target.closest("[data-gdel]"); if (b && confirm("Remove this goal?")) { recDel("goal", b.dataset.gdel); render(); XA.goals(); } };
};

/* =====================================================================================================
   8. This week: what needs doing, on Home and as a Monday notification
   ===================================================================================================== */
XA.weekItems = function () {
  const items = [], c = +S.settings.chaseDays || 90, horizon = addDays(today(), 7);
  S.subs.filter(s => s.status === "Under review" && s.submitted).forEach(s => { const d = subDays(s); if (d >= c) items.push({ w: d >= 2 * c ? 1 : 3, icon: "✉", text: `Chase ${s.journal} (${d} days)`, act: "editsub", id: s.id }); });
  S.subs.filter(s => s.status === "Revision requested").forEach(s => { const r = revFor(s), left = r ? (r.points || []).filter(q => !q.done).length : null, due = r && r.due;
    if (!due || due <= addDays(today(), 21)) items.push({ w: due && due <= horizon ? 0 : 2, icon: "✍", text: `Revision for ${s.journal}${due ? " · due " + fmt(due) : ""}${left != null ? " · " + plural(left, "point") + " left" : ""}`, x: "rev", id: s.id }); });
  recList("review").filter(r => r.status === "Accepted" && r.due && r.due <= horizon).forEach(r => items.push({ w: 1, icon: "🧑‍⚖️", text: `Review for ${r.journal} due ${fmt(r.due)}`, x: "reviewedit", id: r.id }));
  recList("review").filter(r => r.status === "Invited").forEach(r => items.push({ w: 3, icon: "🧑‍⚖️", text: `Reply to the review invitation from ${r.journal}`, x: "reviewedit", id: r.id }));
  callsLive().filter(k => k.deadline && k.deadline >= today() && k.deadline <= addDays(today(), 14)).forEach(k => items.push({ w: 1, icon: "📣", text: `${k.title || k.venue}: deadline ${fmt(k.deadline)}`, x: "calledit", id: k.id }));
  S.papers.filter(p => !p.override && paperInfo(p).stage === "Needs resubmission").map(p => [p, plannedOf(p.id)[0]]).filter(([, n]) => n).slice(0, 3)
    .forEach(([p, n]) => items.push({ w: 4, icon: "🚀", text: `Send ${p.key} to ${n.journal}`, act: "paper", id: p.id }));
  return items.sort((a, b) => a.w - b.w);
};
XA.weekHome = function () {
  const it = XA.weekItems(); if (!it.length) return "";
  return `<div class="card wide" style="margin-top:8px"><div class="t">🗓 This week</div>
    ${it.slice(0, 6).map(x => `<div class="row tap" ${x.act ? `data-act="${x.act}" data-id="${x.id}"` : `data-act="xa" data-x="${x.x}" data-id="${x.id}"`} style="padding:6px 0;border-top:1px solid var(--line);gap:8px;cursor:pointer"><span>${x.icon}</span><span class="grow" style="font-size:14.5px">${esc(x.text)}</span><span class="m">›</span></div>`).join("")}
    ${it.length > 6 ? `<div class="m">+ ${it.length - 6} more</div>` : ""}</div>`;
};
/** Deadlines and the Monday plan for the phone's daily 9 am check (Reminders.java). */
XA.alerts = function () {
  const out = [], at = (key, day, title, text, open) => { if (day && day >= addDays(today(), -1)) out.push({ key, day, title, text, open: open || "home" }); };
  callsLive().filter(k => k.deadline).forEach(k => { [[14, "in two weeks"], [3, "in 3 days"], [1, "tomorrow"]].forEach(([n, w]) => at("call:" + k.id + ":" + n, addDays(k.deadline, -n), "📣 Deadline " + w + ": " + (k.title || k.venue), (k.venue ? k.venue + " · " : "") + fmt(k.deadline))); });
  recList("review").filter(r => r.status === "Accepted" && r.due).forEach(r => { at("rv:" + r.id + ":3", addDays(r.due, -3), "🧑‍⚖️ Review due in 3 days", r.journal + (r.msid ? " · " + r.msid : "")); at("rv:" + r.id + ":0", r.due, "🧑‍⚖️ Review due today", r.journal + (r.msid ? " · " + r.msid : "")); });
  recList("rev").forEach(r => { const s = S.subs.find(x => x.id === r.sub); if (!s || s.status !== "Revision requested" || !r.due) return; const left = (r.points || []).filter(q => !q.done).length;
    at("rev:" + r.id + ":7", addDays(r.due, -7), "✍ Revision due in a week", s.journal + " · " + plural(left, "point") + " left", "review"); });
  const w = XA.weekItems();
  return { alerts: out, weekly: w.length ? { title: "This week: " + plural(w.length, "thing", "things") + " to do", lines: w.slice(0, 6).map(x => x.icon + " " + x.text) } : null };
};

/* =====================================================================================================
   9. Manuscript files: the exact version sent to each journal, from Google Drive
   ===================================================================================================== */
const fileOf = s => { const m = /^(.*?)\s*[—-]\s*(https:\/\/drive\.google\.com\/\S+)$/.exec(s.file || ""); return m ? { name: m[1], url: m[2] } : s.file ? { name: "Manuscript", url: s.file } : null; };
XA.fileRow = function (s) {
  const f = fileOf(s);
  return `<label>Manuscript file</label><div class="row" style="gap:8px;align-items:center">${f ? `<button class="link grow" style="text-align:left" data-act="xa" data-x="fileopen" data-id="${s.id}">📎 ${esc(f.name)}</button><button class="ghost" data-act="xa" data-x="fileclear" data-id="${s.id}">✕</button>`
    : `<span class="m grow">The version you sent, from Google Drive</span>`}<button data-act="xa" data-x="filepick" data-id="${s.id}">${f ? "Change" : "📎 Attach"}</button></div>`;
};
XA.pickFile = async function (s) {
  if (!gDirect()) return toast("Sign in with Google first (More → Google account)");
  try {
    const token = await googleToken(true); let r;
    if (window.RDSK_TEST_PICKFILE) r = await window.RDSK_TEST_PICKFILE();
    else { if (!(window.Android && Android.pickSharedSheet)) return toast("Works in the app");
      r = await new Promise(res => { const id = "p" + (++gSeq); gWait[id] = res; Android.pickSharedSheet(id, token, PICKER_URL + "?mode=file"); }); }
    if (!r.id) { if (r.error) alert(r.error); return; }
    s.file = (r.name || "Manuscript").replace(/[—]/g, "-") + " — https://drive.google.com/file/d/" + r.id + "/view"; persist(); render();
    if ($("#sheet").classList.contains("open")) editSub(s); toast("Attached: " + r.name);
  } catch (err) { alert("Couldn't attach the file: " + err.message); }
};

/* =====================================================================================================
   Hub, Home blocks and action routing
   ===================================================================================================== */
XA.hub = function () {
  const n = (c, f) => recList(c).filter(f || (() => true)).length;
  const tools = [["revs", "✍", "Revision plans", plural(revOpen().length, "open plan")], ["profilepick", "ℹ", "Journal profiles", "citations, fees, volume"], ["calls", "📣", "Calls for papers", plural(callsLive().length, "open call")],
    ["pubs", "🧾", "Publications & CV", plural(published().length, "work")], ["reviews", "🧑‍⚖️", "Reviewing", plural(n("review", r => r.status === "Accepted"), "in progress", "in progress")], ["goals", "🎯", "Goals", plural(n("goal", g => (g.year || thisYear()) === thisYear()), "goal")],
    ["year", "🎉", "Your Research Year", thisYear() + " recap"]];
  if (window.XB) tools.splice(1, 0, ["xb:board", "🗂", "Pipeline board", "drag to update"]), tools.push(["xb:cites", "📈", "Citations", plural(S.papers.filter(p => p.doi).length, "paper") + " tracked"],
    ["xb:focus", "⏱", "Focus timer", Math.round(XB.focusMin() / 6) / 10 + " h so far"], ["xb:calsheet", "📅", "Deadlines → calendar", plural(XB.deadlines().length, "upcoming deadline")], ["xb:games", "🎮", "Games", "4 games for the long wait"], ["xb:demo", "🎭", "Demo mode", window.DEMO ? "on: tap to exit" : "show RD SK safely"]);
  return `<div class="tools" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px">${tools.map(([x, i, t, s]) => `<button class="card tap" data-act="${x.startsWith("xb:") ? "xb" : "xa"}" data-x="${x.replace(/^xb:/, "")}" style="text-align:left;font:inherit;color:inherit;margin:0"><div style="font-size:22px">${i}</div><div class="t" style="font-size:14.5px">${t}</div><div class="m" style="font-size:12.5px">${esc(s)}</div></button>`).join("")}</div>`;
};
XA.revs = function () {
  const open = S.subs.filter(s => s.status === "Revision requested");
  openSheet(`<h3><span>✍ Revision plans</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${open.length ? open.map(s => { const r = revFor(s), pts = r ? r.points || [] : [], dn = pts.filter(q => q.done).length; return `<div class="card tap" data-act="xa" data-x="rev" data-id="${s.id}"><div class="t">${esc((paperById(s.paper) || {}).key || "")}</div><div class="m">${esc(s.journal)}${r && r.due ? " · due " + fmt(r.due) : ""}</div>
      <div class="m" style="margin-top:4px">${r ? `${dn}/${pts.length} points addressed ${r.due ? countdown(r.due) : ""}` : "No plan yet: tap to paste the reviewers' comments"}</div></div>`; }).join("") : `<div class="empty">When a journal asks for a revision, open its plan here (or from the submission) to work through the reviewers' points.</div>`}`);
};
XA.profilePick = function () {
  const js = [...new Set(S.subs.filter(s => isOpen(s) || s.status === "Planned").map(s => s.journal))].filter(j => subKind(S.subs.find(s => s.journal === j)) === "journal");
  openSheet(`<h3><span>ℹ Journal profiles</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${lbl("Any journal", "jpq")}<input id="jpq" autocomplete="off" placeholder="type a journal name"><div class="actions"><button class="primary" id="jpgo">Look up</button></div>
    ${js.length ? `<h2>Your current and shortlisted journals</h2>` + js.map(j => `<div class="card tap" data-jp="${esc(j)}"><div class="t">${esc(j)}${abdcChip(abdcOf(j))}</div>${XA.profLine(j)}</div>`).join("") : ""}`);
  window.__bookPicker = false; journalPicker($("#jpq"));
  $("#jpgo").onclick = () => { const j = $("#jpq").value.trim(); if (j) XA.profileSheet(j, XA.profilePick); };
  $("#sheet").onclick = e => { const b = e.target.closest("[data-jp]"); if (b) XA.profileSheet(b.dataset.jp, XA.profilePick); };
};
XA.homeBlocks = function () { return XA.goalsHome() + XA.weekHome() + XA.callsHome(); };
XA.callsHome = function () {
  const next = callsLive().filter(k => k.deadline && k.deadline >= today()).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 2);
  return next.map(k => `<button class="card tap wide" data-act="xa" data-x="calledit" data-id="${k.id}" style="width:100%;text-align:left;font:inherit;color:inherit;margin-top:8px"><div class="row"><div class="grow"><div class="t">📣 ${esc(k.title || k.venue)}</div><div class="m">${esc(k.venue || k.kind)} · deadline ${fmt(k.deadline)}</div></div>
    <div class="days" style="color:${daysTo(k.deadline) <= 7 ? "var(--need)" : daysTo(k.deadline) <= 30 ? "var(--warn)" : "inherit"}">${daysTo(k.deadline)}<small>days left</small></div></div></button>`).join("");
};
XA.act = function (x, id, el) {
  const s = id && S.subs.find(q => q.id === id);
  switch (x) {
    case "rev": return XA.revSheet(s);
    case "revs": return XA.revs();
    case "profile": return XA.profileSheet(el.dataset.j || (s && s.journal));
    case "profilepick": return XA.profilePick();
    case "compare": return XA.compareSheet(id);
    case "calls": return XA.calls();
    case "calledit": return XA.callEdit(recGet("call", id));
    case "pubs": return XA.pubs();
    case "reviews": return XA.reviews();
    case "reviewedit": return XA.reviewEdit(recGet("review", id));
    case "goals": return XA.goals();
    case "year": return XA.year();
    case "filepick": return XA.pickFile(s);
    case "fileopen": { const f = fileOf(s); return f && openBrowser(f.url); }
    case "fileclear": if (confirm("Remove the attached file? (It stays in your Drive.)")) { s.file = ""; persist(); editSub(s); } return;
  }
};
Object.assign(XA, { calls: XA.calls, pubs: XA.pubs, reviews: XA.reviews });
window.XA = XA;
