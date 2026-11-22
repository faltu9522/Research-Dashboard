/* RD SK extras (2): published papers by DOI / ORCID, citation alerts, pipeline board, journey flow, wait meter,
   focus timer, calendar, voice entry, paper notes, and the Reviewer 2 Run game. Uses the app's globals and extras.js. */
"use strict";
const XB = {};
const ovOpen = id => document.getElementById(id);
function overlay(id, html, z) {
  let o = ovOpen(id); if (!o) { o = document.createElement("div"); o.id = id; o.className = "xov"; document.body.appendChild(o); }
  o.style.cssText = `position:fixed;inset:0;z-index:${z || 9};background:var(--bg);overflow:auto;padding:calc(12px + env(safe-area-inset-top)) 14px 90px`;
  o.innerHTML = html; return o;
}
function closeOv(id) { const o = ovOpen(id); if (o) { if (o._close) o._close(); o.remove(); } }
const DOI_RE = /10\.\d{4,9}\/[^\s"<>,;]+/gi;
const cleanDoi = d => String(d || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").replace(/[).,;]+$/, "").toLowerCase();

/* =====================================================================================================
   1. Published papers: add past publications by DOI, or import them from an ORCID record
   ===================================================================================================== */
const CR_TYPE = { "journal-article": "Journal article", "book-chapter": "Book chapter", "book": "Edited book", "edited-book": "Edited book", "monograph": "Edited book",
  "proceedings-article": "Conference paper", "posted-content": "Other", "report": "Other" };
function shortKey(t) { t = String(t || "").replace(/\s+/g, " ").trim(); const a = t.split(/[:?]/)[0].trim(); return (a.length > 8 ? a : t).slice(0, 60); }
XB.importDois = async function (dois, label) {
  const have = new Set(S.papers.filter(p => p.doi).map(p => cleanDoi(p.doi))); let added = 0, skipped = 0, failed = [];
  for (const raw of dois) {
    const doi = cleanDoi(raw); if (!doi) continue;
    if (have.has(doi)) { skipped++; continue; }
    try {
      const w = await crossrefWork(doi);
      let key = shortKey(w.title || doi); if (S.papers.some(p => p.key.toLowerCase() === key.toLowerCase())) key += " (" + (w.year || "pub") + ")";
      const authors = (w.authors || []).map(a => a.family + (a.given ? ", " + a.given.split(/\s+/).map(x => x[0] + ".").join(" ") : "")).join(", ");
      S.papers.push({ id: uid("p"), key, title: w.title || doi, authors, type: CR_TYPE[w.type] || "Journal article", override: "Published", doi,
        notes: "Published" + (w.journal ? " in " + w.journal : "") + (w.year ? " (" + w.year + ")" : ""), approach: "" });
      have.add(doi); added++;
    } catch (e) { failed.push(doi); }
  }
  persist(); render();
  toast(`${plural(added, "publication")} added${skipped ? ", " + skipped + " already there" : ""}${failed.length ? ", " + failed.length + " not found" : ""}${label ? " (" + label + ")" : ""}`);
  if (added) { FX.confetti(80); XB.citeCheck(true); }
  return { added, skipped, failed };
};
/** ORCID's public record (no key needed). Returns [{title, doi, journal, year, type}]. */
XB.orcidWorks = async function (orcid) {
  const id = (String(orcid).match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i) || [])[0]; if (!id) throw new Error("That doesn't look like an ORCID iD (0000-0000-0000-0000)");
  const r = await httpCall("GET", "https://pub.orcid.org/v3.0/" + id + "/works", "", "");
  if (r.status !== 200) throw new Error(r.status === 404 ? "ORCID record not found" : "ORCID error " + r.status);
  const x = new DOMParser().parseFromString(r.text, "application/xml"), out = [];
  [...x.getElementsByTagNameNS("*", "group")].forEach(g => {
    const s = g.getElementsByTagNameNS("*", "work-summary")[0]; if (!s) return;
    const t = ([...s.getElementsByTagNameNS("*", "title")].find(e => !e.children.length) || {}).textContent || "";
    let doi = ""; [...g.getElementsByTagNameNS("*", "external-id")].forEach(e => { const ty = (e.getElementsByTagNameNS("*", "external-id-type")[0] || {}).textContent, v = (e.getElementsByTagNameNS("*", "external-id-value")[0] || {}).textContent; if (!doi && ty === "doi" && v) doi = cleanDoi(v); });
    const y = (s.getElementsByTagNameNS("*", "year")[0] || {}).textContent || "", j = (s.getElementsByTagNameNS("*", "journal-title")[0] || {}).textContent || "", ty = (s.getElementsByTagNameNS("*", "type")[0] || {}).textContent || "";
    out.push({ title: t.trim(), doi, year: y, journal: j, type: ty });
  });
  return { id, works: out };
};
XB.addPubs = function () {
  const st = S.settings;
  openSheet(`<h3><span>📚 Add published papers</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="m">Earlier publications, so RD SK tracks their citations and lists them in your CV. They are kept as <b>Published</b> papers, outside your submission stats.</div>
    <h2>From DOIs</h2>
    <textarea id="pdois" style="min-height:110px" placeholder="One per line, or paste a whole reference list: RD SK picks out every DOI&#10;10.1177/0170840620912345&#10;https://doi.org/10.1080/…"></textarea>
    <div class="actions"><button class="primary" id="pdgo">Add these</button><button id="pdpaste">📋 Paste</button></div>
    <h2>From your ORCID record</h2>
    <input id="porcid" value="${esc(st.orcid || "")}" placeholder="0000-0002-1825-0097 or orcid.org link" autocapitalize="off">
    <div class="actions"><button id="pogo">Fetch my works</button></div>
    <div id="polist"></div>
    <h2>Profile links <small>opened from Publications</small></h2>
    <label for="pgs">Google Scholar profile</label><input id="pgs" type="url" value="${esc(st.scholar || "")}" placeholder="https://scholar.google.com/citations?user=…">
    <label for="psc">Scopus author profile</label><input id="psc" type="url" value="${esc(st.scopus || "")}" placeholder="https://www.scopus.com/authid/detail.uri?authorId=…">
    <div class="actions"><button id="plsave">Save links</button></div>
    <div class="hint">Google Scholar and Scopus don't offer free data access, so RD SK opens those profiles for you; citation counts come from Crossref (and OpenAlex where available), which are free and open.</div>`);
  $("#pdpaste").onclick = async () => { let c = (window.Android && Android.getClipboard) ? Android.getClipboard() : ""; if (!c && navigator.clipboard) try { c = await navigator.clipboard.readText(); } catch (e) {} if (c) $("#pdois").value = c; else toast("Long-press the box and paste"); };
  $("#pdgo").onclick = async () => { const d = [...new Set(($("#pdois").value.match(DOI_RE) || []).map(cleanDoi))]; if (!d.length) return toast("No DOIs found in the text"); toast("Looking up " + plural(d.length, "DOI") + " on Crossref…"); await XB.importDois(d); XA.pubs(); };
  $("#plsave").onclick = () => { st.scholar = $("#pgs").value.trim(); st.scopus = $("#psc").value.trim(); st.orcid = $("#porcid").value.trim(); persist(false); gsSchedule(); toast("Saved"); };
  $("#pogo").onclick = async () => {
    const v = $("#porcid").value.trim(); if (!v) return toast("Type your ORCID iD"); $("#polist").innerHTML = `<div class="empty">Reading your ORCID record…</div>`;
    try {
      const { id, works } = await XB.orcidWorks(v); st.orcid = id; persist(false); gsSchedule();
      const have = new Set(S.papers.filter(p => p.doi).map(p => cleanDoi(p.doi))), list = works.filter(w => w.doi);
      $("#polist").innerHTML = list.length ? `<div class="m">${plural(works.length, "work")} on ORCID, ${list.length} with a DOI:</div>` + list.map((w, i) => `<label class="card" style="display:flex;gap:8px;align-items:flex-start;text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink);margin:6px 0">
        <input type="checkbox" data-ow="${i}" ${have.has(w.doi) ? "disabled" : "checked"} style="width:auto;margin-top:3px"><span><b>${esc(w.title)}</b><br><span class="m">${esc(w.journal || w.type)}${w.year ? " · " + w.year : ""}${have.has(w.doi) ? " · already in RD SK" : ""}</span></span></label>`).join("") +
        `<div class="actions"><button class="primary" id="poadd">Add ticked works</button></div>` : `<div class="empty">No works with a DOI on that ORCID record yet.</div>`;
      if ($("#poadd")) $("#poadd").onclick = async () => { const pick = list.filter((w, i) => { const c = $(`[data-ow="${i}"]`); return c && c.checked && !c.disabled; }).map(w => w.doi); if (!pick.length) return toast("Nothing ticked"); toast("Adding " + plural(pick.length, "work") + "…"); await XB.importDois(pick, "ORCID"); XA.pubs(); };
    } catch (err) { $("#polist").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
};

/* =====================================================================================================
   2. Citations: weekly check, alerts and a chart per paper
   ===================================================================================================== */
const citeRec = p => recGet("cite", p.id);
XB.citeCount = p => { const r = citeRec(p); return r && r.hist && r.hist.length ? r.hist[r.hist.length - 1][1] : ((S.cref || {})[p.doi] || {}).cites || 0; };
XB.citeCheck = async function (force) {
  const ps = S.papers.filter(p => p.doi); if (!ps.length) return [];
  const last = +S.settings.citeChecked || 0; if (!force && Date.now() - last < 7 * 864e5) return [];
  if (XB._citeBusy) return []; XB._citeBusy = true; const gains = [];
  try {
    for (const p of ps) {
      delete (S.cref || {})[p.doi];
      let w; try { w = await crossrefWork(p.doi); } catch (e) { continue; }
      const r = citeRec(p) || { id: p.id, doi: p.doi, hist: [] }, prev = r.hist.length ? r.hist[r.hist.length - 1][1] : null, n = w.cites || 0;
      if (prev != null && n > prev) gains.push({ p, gain: n - prev, n });
      if (prev !== n || !r.hist.length) { r.hist = r.hist.filter(h => h[0] !== today()).concat([[today(), n]]).slice(-120); }
      if (!r.years || Date.now() - (r.yearsAt || 0) > 30 * 864e5) {   // citations per year (OpenAlex, free; skipped quietly when it is busy)
        try { const o = await getJSON("https://api.openalex.org/works/doi:" + encodeURIComponent(p.doi) + "?select=cited_by_count,counts_by_year"); r.years = (o.counts_by_year || []).map(y => [y.year, y.cited_by_count]).sort((a, b) => a[0] - b[0]); r.yearsAt = Date.now(); } catch (e) {}
      }
      r.doi = p.doi; recPut("cite", r);
    }
    S.settings.citeChecked = Date.now();
    if (gains.length) { S.settings.citeNews = gains.map(g => ({ id: g.p.id, gain: g.gain, n: g.n, at: today() })); FX.confetti(90); toast("📈 " + plural(gains.reduce((a, g) => a + g.gain, 0), "new citation")); }
    persist(false); render();
  } finally { XB._citeBusy = false; }
  return gains;
};
XB.citeNewsHome = function () {
  const news = (S.settings.citeNews || []).filter(x => daysBetween(x.at, today()) <= 14 && paperById(x.id)); if (!news.length) return "";
  return `<button class="card tap wide" data-act="xb" data-x="citenews" style="width:100%;text-align:left;font:inherit;color:inherit;margin-top:8px;border:2px solid var(--acc)">
    <div class="t">📈 New citations</div>${news.slice(0, 3).map(x => `<div class="m"><b style="color:var(--ink)">+${x.gain}</b> ${esc(paperById(x.id).key)} · now ${x.n}</div>`).join("")}</button>`;
};
XB.citeChart = function (p) {
  const r = citeRec(p); if (!p.doi) return "";
  const n = XB.citeCount(p), yrs = r && r.years && r.years.length ? r.years : null, hist = r && r.hist || [];
  let chart = "";
  if (yrs) { const mx = Math.max(1, ...yrs.map(y => y[1]));
    chart = `<div style="display:flex;gap:5px;align-items:flex-end;height:70px;margin:8px 0 2px">${yrs.map(([y, c]) => `<div style="flex:1;text-align:center;font-size:10.5px;color:var(--muted)"><div title="${c}" style="height:${Math.max(2, Math.round(52 * c / mx))}px;background:var(--acc);border-radius:4px 4px 0 0;animation:grow .7s ease-out"></div>'${String(y).slice(2)}<br><b style="color:var(--ink)">${c}</b></div>`).join("")}</div>`; }
  else if (hist.length > 1) { const W = 300, H = 60, xs = hist.map(h => dnum(h[0])), x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1, mx = Math.max(1, ...hist.map(h => h[1]));
    const pts = hist.map(h => [(dnum(h[0]) - x0) / Math.max(1, x1 - x0) * W, H - h[1] / mx * (H - 6)]);
    chart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:64px;margin-top:6px"><polyline fill="none" stroke="var(--acc)" stroke-width="2.5" points="${pts.map(q => q.join(",")).join(" ")}"/></svg>`; }
  return `<div class="card"><div class="row"><div class="t grow">📈 ${plural(n, "citation")}</div><span class="m">Crossref${yrs ? " · per year: OpenAlex" : ""}</span></div>${chart || `<div class="m">The chart fills in as RD SK checks each week.</div>`}</div>`;
};
XB.citeList = function () {
  const ps = S.papers.filter(p => p.doi).sort((a, b) => XB.citeCount(b) - XB.citeCount(a)), total = ps.reduce((a, p) => a + XB.citeCount(p), 0);
  const news = new Map((S.settings.citeNews || []).map(x => [x.id, x]));
  openSheet(`<h3><span>📈 Citations</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><b>${total}</b><span>Citations</span></div><div class="tile"><b>${ps.length}</b><span>Papers tracked</span></div><div class="tile"><b>${hIndex(ps.map(XB.citeCount))}</b><span>h-index (these)</span></div></div>
    ${ps.map(p => `<div class="card tap" data-act="paper" data-id="${p.id}"><div class="row"><div class="grow"><div class="t">${esc(p.key)}</div><div class="m">${esc(p.notes || "")}</div></div><div class="days">${XB.citeCount(p)}${news.has(p.id) ? `<small style="color:var(--acc)">+${news.get(p.id).gain} new</small>` : "<small>cites</small>"}</div></div></div>`).join("") || `<div class="empty">Add DOIs to your papers (or import published ones) to track their citations.</div>`}
    <div class="actions"><button class="primary" id="cicheck">↻ Check now</button><button id="ciadd">📚 Add published papers</button>${S.settings.scholar ? `<button id="cigs">Google Scholar ↗</button>` : ""}${S.settings.scopus ? `<button id="cisc">Scopus ↗</button>` : ""}</div>
    <div class="hint">Checked weekly from Crossref; the phone app also checks in the background and notifies you of new citations. Counts are lower than Google Scholar's, which also counts theses, preprints and books.${S.settings.citeChecked ? " Last check: " + fmt(new Date(S.settings.citeChecked).toISOString().slice(0, 10)) + "." : ""}</div>`);
  $("#cicheck").onclick = async () => { toast("Checking Crossref…"); await XB.citeCheck(true); XB.citeList(); };
  $("#ciadd").onclick = XB.addPubs;
  if ($("#cigs")) $("#cigs").onclick = () => openBrowser(S.settings.scholar);
  if ($("#cisc")) $("#cisc").onclick = () => openBrowser(S.settings.scopus);
  S.settings.citeNews = []; persist(false);
};
function hIndex(cs) { const a = cs.slice().sort((x, y) => y - x); let h = 0; a.forEach((c, i) => { if (c >= i + 1) h = i + 1; }); return h; }
XB.citeForPhone = () => S.papers.filter(p => p.doi).slice(0, 80).map(p => ({ doi: p.doi, title: p.key, count: XB.citeCount(p) }));

/* =====================================================================================================
   3. Pipeline board: drag a card to the next column to record what happened
   ===================================================================================================== */
const COLS = [["todo", "📝 To submit"], ["ur", "⏳ Under review"], ["rev", "✍ Revision"], ["acc", "🏆 Accepted"]];
function boardCards() {
  const c = { todo: [], ur: [], rev: [], acc: [] };
  S.papers.filter(p => !p.override && ["Not yet submitted", "Needs resubmission"].includes(paperInfo(p).stage)).forEach(p => c.todo.push({ t: "p", p, next: plannedOf(p.id)[0] }));
  S.subs.forEach(s => { const p = paperById(s.paper); if (!p) return;
    if (s.status === "Under review") c.ur.push({ t: "s", s, p });
    else if (s.status === "Revision requested") c.rev.push({ t: "s", s, p });
    else if (s.status === "Accepted" && s.decided && daysBetween(s.decided, today()) <= 365) c.acc.push({ t: "s", s, p }); });
  c.ur.sort((a, b) => (subDays(b.s) || 0) - (subDays(a.s) || 0));
  return c;
}
function boardCard(x) {
  const k = kindOf(x.p), ic = KIND[k].icon ? KIND[k].icon + " " : "";
  if (x.t === "p") return `<div class="bcard" data-bp="${x.p.id}"><div class="t">${ic}${esc(x.p.key)}</div><div class="m">${x.next ? "⭐ next: " + esc(x.next.journal) : "no journal shortlisted"}</div></div>`;
  const d = subDays(x.s);
  return `<div class="bcard" data-bs="${x.s.id}"><div class="t">${ic}${esc(x.s.journal)}</div><div class="m">${esc(x.p.key)}</div>${d != null ? `<div class="m">${x.s.status === "Accepted" ? "🎉 " + fmt(x.s.decided) : d + " days"}</div>` : ""}${x.s.status === "Under review" ? XB.waitMeter(x.s, d) : ""}</div>`;
}
XB.board = function () {
  const c = boardCards();
  const o = overlay("board", `<style>
    #board .cols{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px;min-height:60vh}
    #board .col{flex:0 0 min(82vw,300px);scroll-snap-align:start;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;transition:background .2s,transform .2s}
    #board .col.over{background:var(--accent-soft);transform:scale(1.015)}
    #board .col h4{margin:2px 2px 8px;font-size:14px;display:flex;justify-content:space-between}
    #board .bcard{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 10px;margin-bottom:8px;touch-action:pan-x pan-y;user-select:none;-webkit-user-select:none;cursor:grab;animation:bin .35s ease-out backwards}
    #board .bcard.lift{opacity:.35}
    #board .ghost{position:fixed;z-index:30;pointer-events:none;transform:rotate(3deg) scale(1.04);box-shadow:0 12px 30px rgba(0,0,0,.3);width:240px}
    #board .bin{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(140%);background:var(--need);color:#fff;border-radius:30px;padding:14px 26px;font-weight:700;transition:transform .25s;z-index:25}
    #board .bin.show{transform:translateX(-50%)} #board .bin.over{transform:translateX(-50%) scale(1.15)}
    #board .undo{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);border-radius:12px;padding:10px 14px;z-index:26;display:flex;gap:12px;align-items:center}
    @keyframes bin{from{opacity:0;transform:translateY(8px)}}
    @media(min-width:1000px){#board .col{flex:1 1 0}}
  </style>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><button data-xclose>← Back</button><b style="font-size:19px">🗂 Pipeline</b></div>
  <div class="m" style="margin-bottom:8px">Hold a card, then drag it to the next column: RD SK records it with today's date. Drag to the red bin for a rejection. Tap a card to open it.</div>
  <div class="cols">${COLS.map(([k, l]) => `<div class="col" data-col="${k}"><h4><span>${l}</span><span class="m">${c[k].length}</span></h4>${c[k].map(boardCard).join("") || `<div class="m" style="padding:8px">—</div>`}</div>`).join("")}</div>
  <div class="bin">✕ Rejected</div>`);
  o.querySelector("[data-xclose]").onclick = () => closeOv("board");
  boardDrag(o);
};
function boardDrag(o) {
  let drag = null, timer = null, sx = 0, sy = 0;
  const bin = o.querySelector(".bin"), cols = o.querySelector(".cols");
  const target = (x, y) => { if (drag) drag.g.style.display = "none"; const el = document.elementFromPoint(x, y); if (drag) drag.g.style.display = ""; if (!el) return null; if (el.closest(".bin")) return "bin"; const c = el.closest("[data-col]"); return c ? c.dataset.col : null; };
  const start = (card, x, y) => {
    const g = card.cloneNode(true); g.classList.add("ghost"); o.appendChild(g); card.classList.add("lift");
    drag = { card, g, from: card.closest("[data-col]").dataset.col, id: card.dataset.bs || card.dataset.bp, kind: card.dataset.bs ? "s" : "p" };
    if (drag.kind === "s" && drag.from !== "acc") bin.classList.add("show");
    move(x, y); if (window.Android && Android.vibrate) Android.vibrate("0,25");
  };
  const move = (x, y) => {
    drag.g.style.left = (x - 120) + "px"; drag.g.style.top = (y - 30) + "px";
    const t = target(x, y); o.querySelectorAll(".col").forEach(c => c.classList.toggle("over", c.dataset.col === t && t !== drag.from)); bin.classList.toggle("over", t === "bin");
    if (x > innerWidth - 40) cols.scrollLeft += 14; else if (x < 40) cols.scrollLeft -= 14;
  };
  const end = (x, y) => {
    const d = drag; drag = null; if (!d) return; const t = target(x, y);
    d.g.remove(); d.card.classList.remove("lift"); bin.classList.remove("show", "over"); o.querySelectorAll(".col").forEach(c => c.classList.remove("over"));
    if (t && t !== d.from) boardMove(d, t);
  };
  const down = (e, x, y, touch) => { const card = e.target.closest(".bcard"); if (!card) return; sx = x; sy = y;
    if (touch) timer = setTimeout(() => { timer = null; start(card, sx, sy); }, 280); else o._pend = card; };
  o.addEventListener("touchstart", e => down(e, e.touches[0].clientX, e.touches[0].clientY, true), { passive: true });
  o.addEventListener("touchmove", e => { const t = e.touches[0]; if (drag) { e.preventDefault(); move(t.clientX, t.clientY); } else if (timer && Math.hypot(t.clientX - sx, t.clientY - sy) > 10) { clearTimeout(timer); timer = null; } }, { passive: false });
  o.addEventListener("touchend", e => { const t = e.changedTouches[0]; if (timer) { clearTimeout(timer); timer = null; tapCard(e.target); } else if (drag) { e.preventDefault(); end(t.clientX, t.clientY); } });
  o.addEventListener("mousedown", e => down(e, e.clientX, e.clientY, false));
  o.addEventListener("mousemove", e => { if (o._pend && !drag && Math.hypot(e.clientX - sx, e.clientY - sy) > 6) { start(o._pend, e.clientX, e.clientY); o._pend = null; } else if (drag) move(e.clientX, e.clientY); });
  o.addEventListener("mouseup", e => { if (o._pend) { const c = o._pend; o._pend = null; tapCard(c); } else if (drag) end(e.clientX, e.clientY); });
}
function tapCard(el) { const c = el.closest && el.closest(".bcard"); if (!c) return; if (c.dataset.bp) showPaper(paperById(c.dataset.bp)); else { const s = S.subs.find(x => x.id === c.dataset.bs); if (s) editSub(s); } }
function boardMove(d, to) {
  const snap = JSON.stringify(S.subs), say = m => { XB.board(); undoBar(m, snap); };
  if (d.kind === "p") {
    const p = paperById(d.id), nx = plannedOf(p.id)[0];
    if (to !== "ur") return toast("Send it to a journal first: drag it to Under review");
    if (!nx) { toast("Choose the journal"); return editSub(null, p.id); }
    nx.status = "Under review"; nx.submitted = today(); nx.decided = ""; noteActivity(); persist(); render(); celebrate("Planned", "Under review", nx.journal); return say("Sent to " + nx.journal);
  }
  const s = S.subs.find(x => x.id === d.id); if (!s) return;
  const before = s.status;
  if (to === "todo") return toast("To withdraw it, open the card and set Withdrawn");
  if (before === "Accepted") return toast("Already accepted 🎉");
  if (to === "ur" && before === "Revision requested") { s.status = "Revision resubmitted"; if (!s.decided) s.decided = today();
    S.subs.push({ id: uid("s"), paper: s.paper, journal: s.journal, rating: s.rating, status: "Under review", submitted: today(), decided: "", notes: "Revised version resubmitted", titleUsed: s.titleUsed || "" });
    noteActivity(); persist(); render(); celebrate("Revision requested", "Under review", s.journal); return say("Revision resubmitted to " + s.journal); }
  const st = { rev: "Revision requested", acc: "Accepted", bin: "Rejected", ur: "Under review" }[to]; if (!st || st === before) return;
  s.status = st; s.decided = st === "Under review" ? "" : today(); noteActivity(); persist(); render(); celebrate(before, st, s.journal);
  say(statusText(st, subKind(s)) + ": " + s.journal);
  if (st === "Rejected") setTimeout(() => { closeOv("board"); whatNext(paperById(s.paper), s); }, 2600);
}
function undoBar(msg, snap) {
  const o = ovOpen("board"); if (!o) return; const u = document.createElement("div"); u.className = "undo";
  u.innerHTML = `<span>${esc(msg)}</span><button class="link" style="color:var(--bg);font-weight:700">Undo</button>`; o.appendChild(u);
  u.querySelector("button").onclick = () => { S.subs = JSON.parse(snap); persist(); render(); XB.board(); toast("Undone"); };
  setTimeout(() => u.remove(), 6000);
}

/* =====================================================================================================
   4. Journey flow: where papers went, attempt by attempt
   ===================================================================================================== */
function attempts(p) {
  const ss = subsOf(p.id).filter(s => isSent(s) && s.submitted).sort((a, b) => a.submitted.localeCompare(b.submitted)), out = [];
  ss.forEach(s => { const last = out[out.length - 1]; if (last && sameJournal(last.journal, s.journal)) { last.s = s; return; } out.push({ journal: s.journal, s }); });
  return out.map(a => { const s = a.s, st = s.status;
    const o = st === "Accepted" ? "Accepted" : st === "Rejected" ? (/desk/i.test(s.dtype || "") || subDays(s) <= 14 ? "Desk reject" : "Rejected after review")
      : st === "Revision requested" || st === "Revision resubmitted" ? "R&R" : st === "Under review" ? (/revised/i.test(s.notes || "") ? "R&R" : "Under review") : "Other";
    return o; });
}
const FLOW_COL = { "Accepted": "var(--acc)", "R&R": "var(--rev)", "Under review": "var(--ur)", "Desk reject": "#c0392b", "Rejected after review": "var(--need)", "Other": "var(--closed)" };
XB.flowCard = function () {
  const paths = S.papers.filter(p => kindOf(p) === "journal").map(attempts).filter(a => a.length);
  if (paths.length < 2) return "";
  const NC = Math.min(4, Math.max(...paths.map(a => a.length))), cols = [];
  for (let k = 0; k < NC; k++) { const m = {}; paths.forEach(a => { if (a.length > k) { const o = k === NC - 1 ? a[a.length - 1] : a[k]; m[o] = (m[o] || 0) + 1; } }); cols.push(m); }
  const links = []; for (let k = 0; k < NC - 1; k++) { const m = {}; paths.forEach(a => { if (a.length > k + 1) { const f = a[k], t = k + 1 === NC - 1 ? a[a.length - 1] : a[k + 1], key = f + "→" + t; m[key] = (m[key] || 0) + 1; } }); links.push(m); }
  const W = 640, H = 300, nw = 14, gap = 10, total = paths.length, sc = (H - 40 - gap * 5) / total, colX = k => 20 + k * (W - 180) / Math.max(1, NC - 1);
  const ORDER = ["Accepted", "R&R", "Under review", "Rejected after review", "Desk reject", "Other"], pos = [];
  let svg = "";
  cols.forEach((m, k) => { let y = 28; pos[k] = {};
    ORDER.filter(o => m[o]).forEach(o => { const h = Math.max(3, m[o] * sc); pos[k][o] = { y, h, out: y, in: y };
      svg += `<rect x="${colX(k)}" y="${y}" width="${nw}" height="${h}" rx="3" fill="${FLOW_COL[o]}"><title>${o}: ${m[o]}</title></rect>`;
      svg += `<text x="${colX(k) + nw + 4}" y="${y + Math.min(h, 14) - 2}" style="font-size:10.5px;fill:var(--muted)">${o} ${m[o]}</text>`;
      y += h + gap; }); });
  links.forEach((m, k) => ORDER.forEach(f => ORDER.forEach(t => { const n = m[f + "→" + t]; if (!n) return; const a = pos[k][f], b = pos[k + 1][t]; if (!a || !b) return; const h = Math.max(2, n * sc);
    const x0 = colX(k) + nw, x1 = colX(k + 1), y0 = a.out, y1 = b.in; a.out += h; b.in += h; const mx = (x0 + x1) / 2;
    svg = `<path d="M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z" fill="${FLOW_COL[t]}" opacity=".28"><title>${f} → ${t}: ${n}</title></path>` + svg; })));
  const heads = cols.map((m, k) => `<text x="${colX(k)}" y="16" style="font-size:11px;font-weight:700;fill:var(--ink)">${k === NC - 1 && NC === 4 ? "4th+ journal" : ["1st", "2nd", "3rd"][k] + " journal"}</text>`).join("");
  return `<h2>Journey flow <small>${plural(total, "paper")}, attempt by attempt</small></h2><div class="card" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="min-width:560px;width:100%">${heads}${svg}</svg>
    <div class="hint">Each band is papers moving from one journal's outcome to the next journal. The last column holds every 4th-or-later attempt, by its latest outcome.</div></div>`;
};

/* =====================================================================================================
   5. Wait meter: days so far against this journal's usual time to a decision
   ===================================================================================================== */
XB.waitMeter = function (s, d) {
  if (d == null) return ""; const t = turnaround(s.journal), typ = t && t.n >= 1 ? t.med : (+S.settings.chaseDays || 90), pct = d / Math.max(1, typ);
  const col = pct < 0.75 ? "var(--acc)" : pct < 1 ? "var(--warn)" : "var(--need)";
  return `<div title="${d} of usually ${typ} days" style="margin-top:6px"><div style="height:6px;border-radius:4px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:${Math.min(100, Math.round(pct * 100))}%;background:${col};border-radius:4px;transition:width .8s"></i></div>
    <div class="m" style="font-size:11.5px;margin-top:2px">${pct < 1 ? `${d} of ~${typ} days ${t ? "(usual here)" : "(your chase limit)"}` : `${d - typ} days past the usual ${typ}`}</div></div>`;
};

/* =====================================================================================================
   6. Focus timer: writing sessions on a paper
   ===================================================================================================== */
XB.focusMin = pid => recList("focus").filter(f => !pid || f.paper === pid).reduce((a, f) => a + (+f.min || 0), 0);
const hrs = m => m >= 60 ? (Math.round(m / 6) / 10) + " h" : m + " min";
XB.focus = function (pid) {
  const run = S.focusRun;
  if (run) return XB.focusRun();
  const papers = S.papers.filter(p => !["Published", "Closed – rejected"].includes(p.override)).sort((a, b) => a.key.localeCompare(b.key));
  const week = recList("focus").filter(f => daysBetween(f.date, today()) < 7).reduce((a, f) => a + (+f.min || 0), 0);
  openSheet(`<h3><span>⏱ Focus session</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><b>${hrs(week)}</b><span>This week</span></div><div class="tile"><b>${hrs(XB.focusMin())}</b><span>All time</span></div><div class="tile"><b>${recList("focus").length}</b><span>Sessions</span></div></div>
    <label for="fop">Working on</label><select id="fop">${papers.map(p => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.key)}</option>`).join("")}</select>
    <label>Length</label><div class="filters">${[25, 50, 90].map(m => `<button data-fm="${m}" class="${(S.settings.focusLen || 25) === m ? "on" : ""}">${m} min</button>`).join("")}</div>
    <label for="fot">What will you do? (optional)</label><input id="fot" placeholder="e.g. tighten the discussion section">
    <div class="actions"><button class="primary" id="fogo">▶ Start</button></div>
    ${pid ? `<div class="hint">${hrs(XB.focusMin(pid))} focused on this paper so far.</div>` : ""}`);
  $("#sheet").onclick = e => { const b = e.target.closest("[data-fm]"); if (b) { S.settings.focusLen = +b.dataset.fm; persist(false); XB.focus($("#fop").value); } };
  $("#fogo").onclick = () => { S.focusRun = { paper: $("#fop").value, start: Date.now(), len: (S.settings.focusLen || 25) * 60000, task: $("#fot").value.trim(), paused: 0, pausedAt: 0 }; persist(false); closeSheet(); XB.focusRun(); };
};
XB.focusRun = function () {
  const r = S.focusRun; if (!r) return; const p = paperById(r.paper) || {};
  if (window.Android && Android.keepAwake) Android.keepAwake(true);
  const o = overlay("focus", `<div style="min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px">
    <div class="m">Focusing on</div><div class="t" style="font-size:20px">${esc(p.key || "")}</div>${r.task ? `<div class="m">${esc(r.task)}</div>` : ""}
    <svg width="250" height="250" viewBox="0 0 250 250" id="fosvg"><circle cx="125" cy="125" r="110" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle id="foring" cx="125" cy="125" r="110" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" transform="rotate(-90 125 125)" stroke-dasharray="${2 * Math.PI * 110}"/>
      <circle id="fobreath" cx="125" cy="125" r="70" fill="var(--accent-soft)"/><text id="fotime" x="125" y="137" text-anchor="middle" style="font:800 40px system-ui;fill:var(--ink)">--:--</text></svg>
    <div class="m" id="fobr">breathe in…</div>
    <div class="actions" style="justify-content:center"><button id="fopause">⏸ Pause</button><button class="danger" id="fostop">■ Stop and save</button><button class="ghost" id="foquit">Discard</button></div></div>`, 30);
  const C = 2 * Math.PI * 110;
  const tick = () => {
    const now = r.pausedAt || Date.now(), el = now - r.start - r.paused, left = Math.max(0, r.len - el), m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    const t = o.querySelector("#fotime"); if (!t) return;
    t.textContent = m + ":" + String(s).padStart(2, "0"); o.querySelector("#foring").style.strokeDashoffset = C * (1 - left / r.len);
    const ph = (Date.now() / 1000) % 10, k = ph < 5 ? ph / 5 : 1 - (ph - 5) / 5; o.querySelector("#fobreath").setAttribute("r", r.pausedAt ? 70 : 60 + 30 * k); o.querySelector("#fobr").textContent = r.pausedAt ? "paused" : ph < 5 ? "breathe in…" : "breathe out…";
    if (left <= 0) return XB.focusDone(true);
    o._raf = requestAnimationFrame(tick);
  };
  o._close = () => { cancelAnimationFrame(o._raf); if (window.Android && Android.keepAwake) Android.keepAwake(false); };
  o.querySelector("#fopause").onclick = () => { if (r.pausedAt) { r.paused += Date.now() - r.pausedAt; r.pausedAt = 0; o.querySelector("#fopause").textContent = "⏸ Pause"; } else { r.pausedAt = Date.now(); o.querySelector("#fopause").textContent = "▶ Resume"; } persist(false); };
  o.querySelector("#fostop").onclick = () => XB.focusDone(false);
  o.querySelector("#foquit").onclick = () => { if (confirm("Discard this session?")) { S.focusRun = null; persist(false); closeOv("focus"); } };
  tick();
};
XB.focusDone = function (full) {
  const r = S.focusRun; if (!r) return; S.focusRun = null;
  const el = (r.pausedAt || Date.now()) - r.start - r.paused, min = Math.round(Math.min(r.len, el) / 60000);
  closeOv("focus");
  if (min >= 1) { recPut("focus", { paper: r.paper, date: today(), min, task: r.task || "" }); noteActivity(); persist(); render(); }
  else persist(false);
  if (full) { FX.confetti(120); if (window.Android && Android.vibrate) Android.vibrate("0,80,120,80,120,160"); }
  toast(min >= 1 ? `⏱ ${hrs(min)} on ${(paperById(r.paper) || {}).key || "your paper"}${full ? ": well done!" : " saved"}` : "Too short to save");
};

/* =====================================================================================================
   7. Calendar: one-tap Google Calendar links and an .ics file with every deadline
   ===================================================================================================== */
const ymd = iso => iso.replace(/-/g, "");
XB.calUrl = (title, iso, details) => "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + ymd(iso) + "/" + ymd(addDays(iso, 1)) + "&details=" + encodeURIComponent((details || "") + "\n\nFrom RD SK");
XB.calBtn = (title, iso, details) => iso ? `<button type="button" data-act="xb" data-x="cal" data-t="${esc(title)}" data-d="${esc(iso)}" data-n="${esc(details || "")}">📅 Add to Google Calendar</button>` : "";
XB.deadlines = function () {
  const ev = [];
  recList("call").filter(c => c.deadline && c.status !== "Skipped" && c.status !== "Submitted").forEach(c => ev.push({ id: "call-" + c.id, t: "📣 Deadline: " + (c.title || c.venue), d: c.deadline, n: [c.venue, c.link, c.notes].filter(Boolean).join("\n") }));
  recList("review").filter(r => r.status === "Accepted" && r.due).forEach(r => ev.push({ id: "rev-" + r.id, t: "🧑‍⚖️ Review due: " + r.journal, d: r.due, n: [r.msid, r.title, r.link].filter(Boolean).join("\n") }));
  recList("rev").forEach(r => { const s = S.subs.find(x => x.id === r.sub); if (s && s.status === "Revision requested" && r.due) ev.push({ id: "rr-" + r.id, t: "✍ Revision due: " + s.journal, d: r.due, n: (paperById(s.paper) || {}).key || "" }); });
  return ev.filter(e => e.d >= today()).sort((a, b) => a.d.localeCompare(b.d));
};
XB.ics = function () {
  const ev = XB.deadlines(); if (!ev.length) return toast("No upcoming deadlines yet");
  const esc2 = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RD SK//Deadlines//EN", "CALSCALE:GREGORIAN"].concat(...ev.map(e => ["BEGIN:VEVENT", "UID:" + e.id + "@rdsk", "DTSTAMP:" + stamp,
    "DTSTART;VALUE=DATE:" + ymd(e.d), "DTEND;VALUE=DATE:" + ymd(addDays(e.d, 1)), "SUMMARY:" + esc2(e.t), "DESCRIPTION:" + esc2(e.n || ""),
    "BEGIN:VALARM", "TRIGGER:-P3D", "ACTION:DISPLAY", "DESCRIPTION:" + esc2(e.t), "END:VALARM", "END:VEVENT"]), ["END:VCALENDAR"]).join("\r\n");
  saveFile("RD-SK-deadlines.ics", body, "text/calendar");
  toast(plural(ev.length, "deadline") + " saved: open the file to add them to your calendar");
};
XB.calSheet = function () {
  const ev = XB.deadlines();
  openSheet(`<h3><span>📅 Deadlines in your calendar</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    ${ev.map(e => `<div class="card"><div class="t">${esc(e.t)}</div><div class="m">${fmt(e.d)} ${countdown(e.d)}</div><div class="actions">${XB.calBtn(e.t, e.d, e.n)}</div></div>`).join("") || `<div class="empty">Calls for papers, reviews and revision plans with due dates show here.</div>`}
    ${ev.length ? `<div class="actions"><button class="primary" id="icsall">Save all as a calendar file (.ics)</button></div><div class="hint">The file works with Google Calendar, Outlook and Apple Calendar, with a reminder 3 days before each deadline.</div>` : ""}`);
  if ($("#icsall")) $("#icsall").onclick = XB.ics;
};

/* =====================================================================================================
   8. Voice entry: "Submitted Who Spoke to New Media and Society today"
   ===================================================================================================== */
const vwords = s => normJ(s).split(" ").filter(w => w.length > 2 && !["the", "and", "for", "journal", "paper", "with"].includes(w));
function bestMatch(text, items, getText, min) {
  const tw = new Set(vwords(text)); let best = null, bs = 0;
  items.forEach(it => { const ws = vwords(getText(it)); if (!ws.length) return; const hit = ws.filter(w => tw.has(w)).length, sc = hit / ws.length + hit * 0.05; if (hit && sc > bs) { bs = sc; best = it; } });
  return bs >= (min || 0.34) ? best : null;
}
function spokenDate(t) {
  if (/yesterday/i.test(t)) return addDays(today(), -1);
  const m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i) || t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/i);
  if (m) { const [d, mo] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]], M = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(mo.slice(0, 3).toLowerCase()) / 3 + 1;
    let y = +thisYear(); const iso = y + "-" + String(M).padStart(2, "0") + "-" + String(d).padStart(2, "0"); return iso > addDays(today(), 7) ? (y - 1) + iso.slice(4) : iso; }
  return today();
}
XB.parseVoice = function (t) {
  const said = t.trim(), low = said.toLowerCase(), papers = S.papers.filter(p => !p.override);
  const journals = [...new Set(S.subs.map(s => s.journal).concat((window.RD_ABDC || []).map(j => j[0])))];
  const action = /desk.?reject/.test(low) ? "desk" : /reject|declin|turned down/.test(low) ? "Rejected" : /accept|contract|awarded/.test(low) ? "Accepted" : /revis|r ?& ?r|r and r|resubmit/.test(low) ? "Revision requested" : /submit|sent|send|pitched/.test(low) ? "submit" : "";
  let paperPart = said, journalPart = said;
  const to = said.match(/^(.*?)\s+(?:to|at|with)\s+(.+?)(?:\s+(?:today|yesterday|on\s+.+))?$/i); if (action === "submit" && to) { paperPart = to[1]; journalPart = to[2]; }
  const by = said.match(/^(.*?)\s+(?:by|from)\s+(.+?)$/i); if (action && action !== "submit" && by) { paperPart = by[1]; journalPart = by[2]; }
  const paper = bestMatch(paperPart, papers, p => p.key + " " + (p.title || ""));
  if (action === "submit") return { action, paper, journal: bestMatch(journalPart, journals, j => j, 0.5) || (to ? to[2].replace(/\s+(today|yesterday)$/i, "").trim() : ""), date: spokenDate(low), said };
  const open = S.subs.filter(s => isOpen(s) && (!paper || s.paper === paper.id));
  const sub = bestMatch(journalPart, open, s => s.journal, 0.5) || (paper && open.length === 1 ? open[0] : null);
  return { action, paper: paper || (sub && paperById(sub.paper)), sub, date: spokenDate(low), said };
};
XB.voice = function () {
  const id = "v" + Date.now();
  window.rdHeard = (rid, text, failed) => { if (failed) return toast("Speech input isn't available on this phone"); if (text) XB.voiceSheet(text); };
  if (window.Android && Android.listen) return Android.listen(id, "Say what happened, e.g. “Submitted Who Spoke to New Media and Society today”");
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { const t = prompt("Voice input isn't available in this browser. Type it instead:"); if (t) XB.voiceSheet(t); return; }
  const r = new R(); r.lang = navigator.language || "en-GB"; r.interimResults = false; toast("🎤 Listening…");
  r.onresult = e => XB.voiceSheet(e.results[0][0].transcript); r.onerror = e => toast("Didn't catch that (" + e.error + ")"); r.start();
};
XB.voiceSheet = function (text) {
  const v = XB.parseVoice(text);
  const plan = v.action === "submit" ? (v.paper && v.journal ? `Submit <b>${esc(v.paper.key)}</b> to <b>${esc(v.journal)}</b> on ${fmt(v.date)}` : "")
    : v.action && v.sub ? `${v.action === "desk" ? "Desk rejection" : esc(statusText(v.action, subKind(v.sub)))} from <b>${esc(v.sub.journal)}</b> for <b>${esc((v.paper || {}).key || "")}</b>, ${fmt(v.date)}` : "";
  openSheet(`<h3><span>🎤 I heard</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="card" style="font-size:17px">“${esc(v.said)}”</div>
    ${plan ? `<div class="m" style="color:var(--ink);margin:8px 0">${plan}</div><div class="actions"><button class="primary" id="vok">Looks right: open it</button><button id="vagain">🎤 Try again</button></div>`
      : `<div class="empty">I couldn't match that to a paper and journal. Try: “Submitted <i>paper</i> to <i>journal</i> today”, “<i>Paper</i> rejected by <i>journal</i>”, or “<i>Journal</i> accepted <i>paper</i>”.</div><div class="actions"><button class="primary" id="vagain">🎤 Try again</button><button id="vsearch">🔍 Search for it</button></div>`}`);
  if ($("#vagain")) $("#vagain").onclick = () => { closeSheet(); XB.voice(); };
  if ($("#vsearch")) $("#vsearch").onclick = () => { closeSheet(); query = v.said; setTab("home"); };
  if ($("#vok")) $("#vok").onclick = () => {
    if (v.action === "submit") { editSub(null, v.paper.id); $("#fj").value = v.journal; $("#fe").value = v.date; $("#fs").value = "Under review"; $("#fj").dispatchEvent(new Event("input")); return; }
    decide(v.sub); const pick = v.action === "desk" ? "Rejected" : v.action; const b = $(`#dg [data-o="${pick}"]`); if (b) b.click(); if ($("#dd")) $("#dd").value = v.date;
    if (v.action === "desk" && $("#dn")) $("#dn").value = ($("#dn").value ? $("#dn").value + " | " : "") + "Desk rejection";
  };
};

/* =====================================================================================================
   9. Notes on a paper: a dated thread, shared with co-authors through the shared sheet
   ===================================================================================================== */
XB.notesOf = pid => recList("note").filter(n => n.paper === pid).sort((a, b) => (b.at || 0) - (a.at || 0));
XB.notesBlock = function (p) {
  const ns = XB.notesOf(p.id), me = S.settings.myName || "Me";
  return `<h2>💬 Notes <small>shared with co-authors on their sheet</small></h2>
    <div class="row" style="gap:6px"><input id="nt" class="grow" placeholder="e.g. Sent the revised intro to Anamita"><button class="primary" data-act="xb" data-x="noteadd" data-id="${p.id}">Add</button></div>
    ${ns.map(n => `<div class="card" style="padding:9px 12px"><div class="m"><b style="color:var(--ink)">${esc(n.by || "")}</b> · ${fmt(new Date(n.at).toISOString().slice(0, 10))}${n.by === me ? ` · <button class="link" data-act="xb" data-x="notedel" data-id="${n.id}" style="font-size:12px">delete</button>` : ""}</div><div style="white-space:pre-wrap">${esc(n.text)}</div></div>`).join("") || `<div class="m">No notes yet.</div>`}`;
};
XB.notesForShare = ids => { const o = {}; Object.values(recColl("note")).forEach(n => { if (ids.has(n.paper)) o[n.id] = n; }); return o; };

/* =====================================================================================================
   10. Reviewer 2 Run: tap to jump over desk rejections, collect citations
   ===================================================================================================== */
XB.game = function () {
  const o = overlay("game", `<canvas id="gcv" style="display:block;width:100%;height:100%;touch-action:none"></canvas>
    <button id="gx" style="position:fixed;top:calc(10px + env(safe-area-inset-top));right:12px;z-index:2;background:rgba(0,0,0,.35);color:#fff;border:0;border-radius:20px;width:40px;height:40px;font-size:20px">✕</button>`, 40);
  o.style.padding = "0"; o.style.overflow = "hidden";
  const cv = o.querySelector("#gcv"), g = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
  let W, H, G; const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); G = H * 0.78; }; size(); addEventListener("resize", size);
  const best = () => +S.settings.gameBest || 0;
  let st, raf, last;
  const reset = () => { st = { y: 0, vy: 0, jumps: 0, speed: 330, dist: 0, stars: 0, obs: [], stx: [], t: 0, next: 1.2, nextStar: 2, over: false, started: false, shake: 0, parts: [], hold: false }; };
  reset();
  const OB = [{ w: 46, h: 40, label: "DESK", sub: "REJECT", col: "#d64545" }, { w: 54, h: 58, label: "REV", sub: "#2", col: "#7b2cbf" }, { w: 70, h: 34, label: "MAJOR", sub: "REVISIONS", col: "#e07a1f" }];
  const jump = () => { if (st.over) { if (Date.now() - st.overAt > 500) { reset(); st.started = true; } return; } st.started = true;
    if (st.jumps < 2) { st.vy = st.jumps ? -620 : -720; st.jumps++; for (let i = 0; i < 6; i++) st.parts.push({ x: 90, y: G - st.y, vx: -60 - Math.random() * 90, vy: -Math.random() * 120, l: .4 }); } };
  const press = e => { e.preventDefault(); st.hold = true; jump(); }, release = () => { st.hold = false; };
  cv.addEventListener("pointerdown", press); cv.addEventListener("pointerup", release); cv.addEventListener("pointercancel", release);
  const key = e => { if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); if (!e.repeat) { st.hold = true; jump(); } } };
  const keyUp = e => { if (e.code === "Space" || e.code === "ArrowUp") st.hold = false; };
  addEventListener("keydown", key); addEventListener("keyup", keyUp);
  o.querySelector("#gx").onclick = () => closeOv("game");
  o._close = () => { cancelAnimationFrame(raf); removeEventListener("resize", size); removeEventListener("keydown", key); removeEventListener("keyup", keyUp); };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.fill(); };
  const step = dt => {
    if (!st.started || st.over) return;
    st.t += dt; st.speed = Math.min(820, 330 + st.t * 9); st.dist += st.speed * dt;
    st.vy += (st.hold && st.vy < 0 ? 1500 : 2600) * dt; st.y -= st.vy * dt; if (st.y <= 0) { st.y = 0; st.vy = 0; st.jumps = 0; }
    st.next -= dt; if (st.next <= 0) { const k = OB[Math.random() < Math.min(.5, st.t / 60) ? (Math.random() < .5 ? 1 : 2) : 0]; st.obs.push(Object.assign({ x: W + 40 }, k)); st.next = Math.max(.55, 1.5 - st.t / 60) + Math.random() * .7; }
    st.nextStar -= dt; if (st.nextStar <= 0) { st.stx.push({ x: W + 30, y: 60 + Math.random() * 110, a: 0 }); st.nextStar = 1.2 + Math.random() * 1.6; }
    st.obs.forEach(b => b.x -= st.speed * dt); st.obs = st.obs.filter(b => b.x > -100);
    st.stx.forEach(s => { s.x -= st.speed * dt; s.a += dt * 5; }); 
    const px = 72, py = G - st.y - 42, pw = 34, ph = 42;
    st.stx = st.stx.filter(s => { if (Math.abs(s.x - (px + pw / 2)) < 26 && Math.abs((G - s.y) - (py + ph / 2)) < 30) { st.stars++; for (let i = 0; i < 10; i++) st.parts.push({ x: s.x, y: G - s.y, vx: (Math.random() - .5) * 260, vy: (Math.random() - .5) * 260, l: .5, c: "#ffd27a" }); return false; } return s.x > -40; });
    for (const b of st.obs) if (px + pw - 6 > b.x + 4 && px + 6 < b.x + b.w - 4 && py + ph - 4 > G - b.h) { st.over = true; st.overAt = Date.now(); st.shake = .35;
      const sc = score(); if (sc > best()) { S.settings.gameBest = sc; persist(false); st.record = true; FX.confetti(100); } if (window.Android && Android.vibrate) Android.vibrate("0,60,40,90"); break; }
    st.parts.forEach(q => { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 400 * dt; q.l -= dt; }); st.parts = st.parts.filter(q => q.l > 0);
  };
  const score = () => Math.floor(st.dist / 40) + st.stars * 10;
  const draw = () => {
    const sx = st.shake > 0 ? (Math.random() - .5) * 10 : 0; st.shake = Math.max(0, st.shake - .016);
    g.save(); g.translate(sx, 0);
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#1d3557"); sky.addColorStop(1, "#457b9d"); g.fillStyle = sky; g.fillRect(-10, 0, W + 20, H);
    const off = st.dist * .2 % 160; g.fillStyle = "rgba(255,255,255,.07)";   // far bookshelves
    for (let x = -off; x < W + 160; x += 160) { g.fillRect(x, G - 150, 120, 150); for (let k = 0; k < 5; k++) { g.fillStyle = `hsla(${(x * 7 + k * 50) % 360},50%,70%,.12)`; g.fillRect(x + 8 + k * 22, G - 140, 16, 60); g.fillRect(x + 6 + k * 22, G - 70, 18, 60); } g.fillStyle = "rgba(255,255,255,.07)"; }
    g.fillStyle = "#2a2a2a"; g.fillRect(-10, G, W + 20, H - G); g.fillStyle = "#3d3d3d"; const d2 = st.dist % 40; for (let x = -d2; x < W; x += 40) g.fillRect(x, G + 8, 22, 4);
    st.stx.forEach(s => { g.save(); g.translate(s.x, G - s.y); g.rotate(Math.sin(s.a) * .3); g.font = "26px system-ui"; g.textAlign = "center"; g.fillText("⭐", 0, 9); g.restore(); });
    st.obs.forEach(b => { g.fillStyle = b.col; rr(b.x, G - b.h, b.w, b.h, 6); g.fillStyle = "#fff"; g.textAlign = "center"; g.font = "800 11px system-ui"; g.fillText(b.label, b.x + b.w / 2, G - b.h / 2 - 1); g.font = "700 8.5px system-ui"; g.fillText(b.sub, b.x + b.w / 2, G - b.h / 2 + 10); });
    const py = G - st.y - 42, tilt = st.y > 0 ? Math.max(-.35, Math.min(.35, st.vy / 1800)) : Math.sin(st.dist / 18) * .05;   // the manuscript hero
    g.save(); g.translate(89, py + 21); g.rotate(tilt); g.fillStyle = "#fff"; rr(-17, -21, 34, 42, 4); g.fillStyle = "#cfd8e3"; for (let k = 0; k < 4; k++) g.fillRect(-11, -12 + k * 7, k === 0 ? 16 : 22, 3);
    g.fillStyle = "#1d3557"; g.beginPath(); g.arc(-5, -16, 2.2, 0, 7); g.arc(5, -16, 2.2, 0, 7); g.fill();
    if (st.y === 0 && st.started && !st.over) { const ph = Math.sin(st.dist / 9) * 5; g.fillStyle = "#fff"; g.fillRect(-9 + ph, 20, 5, 7); g.fillRect(4 - ph, 20, 5, 7); }
    g.restore();
    st.parts.forEach(q => { g.globalAlpha = Math.max(0, q.l * 2); g.fillStyle = q.c || "#fff"; g.fillRect(q.x, q.y, 4, 4); }); g.globalAlpha = 1;
    g.fillStyle = "#fff"; g.textAlign = "left"; g.font = "800 22px system-ui"; g.fillText(score(), 18, 48); g.font = "600 13px system-ui"; g.fillStyle = "rgba(255,255,255,.75)"; g.fillText("⭐ " + st.stars + "   best " + best(), 18, 68);
    g.textAlign = "center";
    if (!st.started) { g.fillStyle = "#fff"; g.font = "800 30px system-ui"; g.fillText("Reviewer 2 Run", W / 2, H * .3); g.font = "500 16px system-ui"; g.fillText("Tap to jump · tap again in the air to double-jump", W / 2, H * .3 + 34); g.fillText("Hold for a higher jump · grab ⭐ citations", W / 2, H * .3 + 58); }
    if (st.over) { g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(-10, 0, W + 20, H); g.fillStyle = "#fff"; g.font = "800 32px system-ui"; g.fillText(st.record ? "New record! 🏆" : ["Desk rejected!", "Reviewer 2 strikes again", "Major revisions…", "Not a good fit for this journal"][Math.floor(st.overAt / 1000) % 4], W / 2, H * .36);
      g.font = "600 18px system-ui"; g.fillText("Score " + score() + "  ·  best " + best(), W / 2, H * .36 + 36); g.font = "500 15px system-ui"; g.fillText("Tap to resubmit", W / 2, H * .36 + 66); }
    g.restore();
  };
  const loop = t => { const dt = Math.min(.034, ((t - (last || t)) / 1000)); last = t; step(dt); draw(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
};

/* ---------- routing ---------- */
XB.act = function (x, id, el) {
  switch (x) {
    case "board": return XB.board();
    case "focus": return XB.focus(id);
    case "cal": return openBrowser(XB.calUrl(el.dataset.t, el.dataset.d, el.dataset.n));
    case "calsheet": return XB.calSheet();
    case "voice": return XB.voice();
    case "game": return XB.game();
    case "addpubs": return XB.addPubs();
    case "citenews": case "cites": return XB.citeList();
    case "noteadd": { const t = ($("#nt") || {}).value || ""; if (!t.trim()) return toast("Type a note");
      recPut("note", { paper: id, text: t.trim(), by: S.settings.myName || "Me" }); noteActivity(); persist(); showPaper(paperById(id)); toast("Note added"); return; }
    case "notedel": { const n = recGet("note", id); if (n && confirm("Delete this note?")) { recDel("note", id); showPaper(paperById(n.paper)); } return; }
  }
};
window.XB = XB;

/* ---------- on start: resume a focus session, weekly citation check ---------- */
setTimeout(() => { try { if (S.focusRun) XB.focusRun(); } catch (e) {} }, 600);
setTimeout(() => { XB.citeCheck(false).catch(() => {}); }, 9000);
