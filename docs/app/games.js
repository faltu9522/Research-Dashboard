/* RD SK games: small, original, academic-themed time-passers. Each draws on one canvas, keeps the action in the upper
   part of the screen (the thumb taps below), saves a best score, and closes with ✕ or the back button. */
"use strict";
const XG = {};
const gBest = k => +((S.settings.games || {})[k] || 0);
function gSave(k, v) { if (v > gBest(k)) { S.settings.games = Object.assign({}, S.settings.games, { [k]: v }); persist(false); return true; } return false; }
const buzz = p => { if (window.Android && Android.vibrate) Android.vibrate(p); };
/** Opens a full-screen canvas game; returns {g, W, H, cv, o, onFrame, end}. */
function gameFrame(id, init) {
  const o = overlay(id, `<canvas style="display:block;width:100%;height:100%;touch-action:none"></canvas>
    <button class="gx" style="position:fixed;top:calc(10px + env(safe-area-inset-top));right:12px;z-index:2;background:rgba(0,0,0,.35);color:#fff;border:0;border-radius:20px;width:40px;height:40px;font-size:20px">✕</button>`, 40);
  o.style.padding = "0"; o.style.overflow = "hidden";
  const cv = o.querySelector("canvas"), g = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1), F = { g, cv, o };
  const size = () => { F.W = innerWidth; F.H = innerHeight; cv.width = F.W * dpr; cv.height = F.H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); if (F.resize) F.resize(); };
  size(); addEventListener("resize", size);
  let raf, last; const loop = t => { const dt = Math.min(.034, (t - (last || t)) / 1000); last = t; if (F.frame) F.frame(dt); raf = requestAnimationFrame(loop); };
  o.querySelector(".gx").onclick = () => closeOv(id);
  o._close = () => { cancelAnimationFrame(raf); removeEventListener("resize", size); if (F.cleanup) F.cleanup(); };
  init(F); raf = requestAnimationFrame(loop); return F;
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.fill(); }
function txt(g, s, x, y, font, col, al) { g.font = font; g.fillStyle = col || "#fff"; g.textAlign = al || "center"; g.fillText(s, x, y); }
function overText(F, title, sc, best, record, again) {
  const { g, W, H } = F; g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 0, W, H);
  txt(g, record ? "New record! 🏆" : title, W / 2, H * .2, "800 30px system-ui"); txt(g, "Score " + sc + "  ·  best " + best, W / 2, H * .2 + 36, "600 18px system-ui");
  txt(g, again, W / 2, H * .2 + 66, "500 15px system-ui");
}

/* =====================================================================================================
   Stack Your CV: tap to drop each sliding section of the paper; only the overlap stays
   ===================================================================================================== */
const SECTIONS = ["Abstract", "Introduction", "Literature", "Theory", "Hypotheses", "Methods", "Data", "Findings", "Robustness", "Discussion", "Contribution", "Limitations", "Conclusion", "References", "Appendix", "Cover letter", "Response letter", "Revision", "Proofs", "Published!"];
XG.stack = () => gameFrame("gstack", F => {
  let st; const BH = 34;
  const reset = () => { const w = Math.min(260, F.W * .62); st = { blocks: [{ x: (F.W - w) / 2, w, y: 0 }], cur: null, dir: 1, speed: 170, cam: 0, over: false, started: false, combo: 0, falls: [], score: 0 }; spawn(); };
  const spawn = () => { const top = st.blocks[st.blocks.length - 1]; st.cur = { x: st.dir > 0 ? -top.w : F.W, w: top.w, y: st.blocks.length }; st.speed = Math.min(520, 170 + st.blocks.length * 11); };
  const drop = () => {
    if (st.over) { if (Date.now() - st.overAt > 500) { reset(); st.started = true; } return; }
    if (!st.started) { st.started = true; return; }
    const c = st.cur, top = st.blocks[st.blocks.length - 1], a = Math.max(c.x, top.x), b = Math.min(c.x + c.w, top.x + top.w);
    if (b - a <= 0) { st.falls.push({ x: c.x, w: c.w, y: c.y, vy: 0 }); st.over = true; st.overAt = Date.now(); st.record = gSave("stack", st.score); if (st.record) FX.confetti(100); buzz("0,60,40,90"); return; }
    if (Math.abs(c.x - top.x) < 5) { c.x = top.x; st.combo++; if (st.combo >= 3) { c.w = Math.min(top.w + 10, F.W * .7); c.x = top.x - 5; } buzz("0,15"); }
    else { st.combo = 0; if (c.x < top.x) st.falls.push({ x: c.x, w: top.x - c.x, y: c.y, vy: 0 }); else st.falls.push({ x: b, w: c.x + c.w - b, y: c.y, vy: 0 }); c.x = a; c.w = b - a; }
    st.blocks.push(c); st.score = st.blocks.length - 1; st.dir *= -1; spawn();
  };
  F.cv.addEventListener("pointerdown", e => { e.preventDefault(); drop(); });
  const key = e => { if (e.code === "Space") { e.preventDefault(); drop(); } }; addEventListener("keydown", key); F.cleanup = () => removeEventListener("keydown", key);
  reset();
  F.frame = dt => {
    const { g, W, H } = F, base = H * .6;   // the stack's base sits above the thumb
    if (st.started && !st.over) { const c = st.cur; c.x += st.dir * st.speed * dt; if (c.x > W - c.w * .2 && st.dir > 0) st.dir = -1; if (c.x < -c.w * .8 && st.dir < 0) st.dir = 1; }
    st.cam += ((Math.max(0, st.blocks.length - 7) * BH) - st.cam) * Math.min(1, dt * 5);
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#14213d"); sky.addColorStop(1, "#3a506b"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = "#1b1b1b"; g.fillRect(0, base + st.cam, W, H);
    const yOf = i => base - (i + 1) * BH + st.cam, col = i => `hsl(${(205 + i * 17) % 360},55%,${58 - (i % 2) * 6}%)`;
    st.blocks.forEach((b, i) => { g.fillStyle = col(i); rrect(g, b.x, yOf(i), b.w, BH - 3, 5); if (b.w > 60) txt(g, SECTIONS[(i) % SECTIONS.length], b.x + b.w / 2, yOf(i) + 21, "700 12.5px system-ui", "rgba(255,255,255,.9)"); });
    if (!st.over && st.cur) { const c = st.cur, i = st.blocks.length; g.fillStyle = col(i); rrect(g, c.x, yOf(i), c.w, BH - 3, 5); if (c.w > 60) txt(g, SECTIONS[i % SECTIONS.length], c.x + c.w / 2, yOf(i) + 21, "700 12.5px system-ui", "rgba(255,255,255,.9)"); }
    st.falls.forEach(f => { f.vy += 1400 * dt; f.y -= f.vy * dt / BH; g.fillStyle = "rgba(255,255,255,.45)"; rrect(g, f.x, yOf(f.y), f.w, BH - 3, 5); }); st.falls = st.falls.filter(f => yOf(f.y) < H + 50);
    txt(g, String(st.score), 18, 48, "800 24px system-ui", "#fff", "left"); txt(g, "best " + gBest("stack") + (st.combo >= 2 ? "   🔥 perfect ×" + st.combo : ""), 18, 70, "600 13px system-ui", "rgba(255,255,255,.75)", "left");
    txt(g, "👆 tap anywhere to drop", W / 2, base + st.cam + (H - base) * .5, "600 15px system-ui", "rgba(255,255,255,.35)");
    if (!st.started) { txt(g, "Stack Your CV", W / 2, H * .17, "800 30px system-ui"); txt(g, "Tap to drop each section on the one below", W / 2, H * .17 + 32, "500 16px system-ui"); txt(g, "Only the overlap stays · 3 perfect drops grow it back", W / 2, H * .17 + 56, "500 15px system-ui"); }
    if (st.over) overText(F, "The paper toppled!", st.score, gBest("stack"), st.record, "Tap to start a new draft");
  };
});

/* =====================================================================================================
   Catch the Acceptances: slide the inbox to catch good news, dodge rejections
   ===================================================================================================== */
const ITEMS = [{ t: "ACCEPTED", c: "#2a9d8f", v: 10, good: true, p: .30 }, { t: "⭐", c: null, v: 5, good: true, p: .25, star: true }, { t: "R&R", c: "#e9a23b", v: 3, good: true, p: .12 },
  { t: "REJECT", c: "#d64545", bad: true, p: .2 }, { t: "REV 2", c: "#7b2cbf", bad: true, p: .13 }];
XG.catch = () => gameFrame("gcatch", F => {
  let st; const reset = () => { st = { x: F.W / 2, items: [], t: 0, next: .6, lives: 3, score: 0, over: false, started: false, pops: [] }; };
  const pick = () => { let r = Math.random(), a = 0; for (const it of ITEMS) { a += it.p; if (r < a) return it; } return ITEMS[0]; };
  const move = x => { st.x = Math.max(40, Math.min(F.W - 40, x)); };
  F.cv.addEventListener("pointerdown", e => { e.preventDefault(); if (st.over) { if (Date.now() - st.overAt > 500) { reset(); st.started = true; } return; } st.started = true; move(e.clientX); });
  F.cv.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") move(e.clientX); });
  const key = e => { if (e.code === "ArrowLeft") move(st.x - 40); if (e.code === "ArrowRight") move(st.x + 40); if (e.code === "Space") st.started = true; }; addEventListener("keydown", key); F.cleanup = () => removeEventListener("keydown", key);
  reset();
  F.frame = dt => {
    const { g, W, H } = F, tray = H * .58;   // the inbox rides above the thumb; slide anywhere below
    if (st.started && !st.over) {
      st.t += dt; st.next -= dt; if (st.next <= 0) { const it = pick(); st.items.push(Object.assign({ x: 30 + Math.random() * (W - 60), y: -30, vy: 150 + st.t * 6 + Math.random() * 60, r: (Math.random() - .5) * .4 }, it)); st.next = Math.max(.28, .85 - st.t / 90); }
      st.items.forEach(i => i.y += i.vy * dt);
      st.items = st.items.filter(i => {
        if (i.y > tray - 18 && i.y < tray + 12 && Math.abs(i.x - st.x) < 52) {
          if (i.bad) { st.lives--; buzz("0,50"); st.pops.push({ x: i.x, y: tray - 30, t: "−1 ❤", c: "#ff8080", l: 1 }); if (st.lives <= 0) { st.over = true; st.overAt = Date.now(); st.record = gSave("catch", st.score); if (st.record) FX.confetti(100); } }
          else { st.score += i.v; st.pops.push({ x: i.x, y: tray - 30, t: "+" + i.v, c: "#9ef0c0", l: 1 }); }
          return false;
        }
        return i.y < H * .72;
      });
    }
    st.pops.forEach(p => { p.y -= 40 * dt; p.l -= dt; }); st.pops = st.pops.filter(p => p.l > 0);
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#0b3954"); sky.addColorStop(1, "#087e8b"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = "#16202a"; g.fillRect(0, H * .72, W, H);
    st.items.forEach(i => { g.save(); g.translate(i.x, i.y); g.rotate(i.r); if (i.star) txt(g, "⭐", 0, 10, "28px system-ui"); else { g.fillStyle = i.c; rrect(g, -34, -14, 68, 28, 6); txt(g, i.t, 0, 5, "800 11.5px system-ui"); } g.restore(); });
    g.fillStyle = "#f1f1f1"; rrect(g, st.x - 50, tray, 100, 22, 6); g.fillStyle = "#cfd8e3"; rrect(g, st.x - 44, tray + 4, 88, 5, 3); txt(g, "📥 INBOX", st.x, tray + 40, "700 11px system-ui", "rgba(255,255,255,.7)");
    st.pops.forEach(p => { g.globalAlpha = Math.max(0, p.l); txt(g, p.t, p.x, p.y, "800 16px system-ui", p.c); }); g.globalAlpha = 1;
    txt(g, String(st.score), 18, 48, "800 24px system-ui", "#fff", "left"); txt(g, "❤".repeat(Math.max(0, st.lives)) + "   best " + gBest("catch"), 18, 70, "600 13px system-ui", "rgba(255,255,255,.8)", "left");
    txt(g, "👈 slide your thumb here 👉", W / 2, H * .86, "600 15px system-ui", "rgba(255,255,255,.35)");
    if (!st.started) { txt(g, "Catch the Acceptances", W / 2, H * .17, "800 28px system-ui"); txt(g, "Slide to catch ACCEPTED, R&R and ⭐ citations", W / 2, H * .17 + 32, "500 15px system-ui"); txt(g, "Dodge REJECT and Reviewer 2 · 3 lives", W / 2, H * .17 + 54, "500 15px system-ui"); }
    if (st.over) overText(F, "Inbox full of rejections", st.score, gBest("catch"), st.record, "Tap to try again");
  };
});

/* =====================================================================================================
   Inbox Sort: good news right, bad news left, before the timer runs out
   ===================================================================================================== */
const GOOD = ["Your manuscript has been accepted", "Minor revisions requested", "Invitation to revise and resubmit", "Your paper has been cited", "Reviewer 2 recommends acceptance",
  "Your article is now online", "Congratulations on your publication", "We are pleased to inform you", "Proofs ready for your approval", "Your grant has been awarded",
  "Invitation to submit a full paper", "Your abstract has been accepted", "Best paper award shortlist", "Editor's choice: your article", "Your chapter has been accepted"];
const BAD = ["Unfortunately, we cannot consider your manuscript", "Decision: reject", "Not a good fit for this journal", "Desk rejection", "Reviewer 2 has some concerns",
  "We regret to inform you", "Your submission is out of scope", "The editors have decided to decline", "Major concerns about the contribution", "Your grant was not funded",
  "We received many strong submissions", "Please reformat and resubmit from scratch", "Missing the theoretical contribution", "Reject and do not resubmit", "Your abstract was not selected"];
XG.inbox = () => gameFrame("ginbox", F => {
  let st; const reset = () => { st = { card: null, score: 0, streak: 0, limit: 3.2, t: 0, over: false, started: false, fly: null }; next(); };
  const next = () => { const good = Math.random() < .5, list = good ? GOOD : BAD; st.card = { good, text: list[Math.floor(Math.random() * list.length)], t: 0, dx: 0 }; };
  const answer = right => {
    if (st.over) { if (Date.now() - st.overAt > 500) { reset(); st.started = true; } return; }
    if (!st.started) { st.started = true; return; }
    const ok = right === st.card.good; st.fly = { good: right, text: st.card.text, x: 0, l: .35, ok };
    if (!ok) { st.over = true; st.why = st.card.good ? "That was good news!" : "That was bad news!"; st.overAt = Date.now(); st.record = gSave("inbox", st.score); if (st.record) FX.confetti(100); buzz("0,60,40,90"); return; }
    st.streak++; st.score += 1 + Math.floor(st.streak / 10); st.limit = Math.max(1.05, 3.2 - st.score * .05); buzz("0,10"); next();
  };
  let sx = null;
  F.cv.addEventListener("pointerdown", e => { e.preventDefault(); sx = e.clientX; });
  F.cv.addEventListener("pointermove", e => { if (sx != null && st.card && st.started && !st.over) st.card.dx = e.clientX - sx; });
  F.cv.addEventListener("pointerup", e => { if (sx == null) return; const d = e.clientX - sx; sx = null; if (st.card) st.card.dx = 0;
    if (!st.started || st.over) return answer(true); if (Math.abs(d) > 40) answer(d > 0); else answer(e.clientX > F.W / 2); });
  const key = e => { if (e.code === "ArrowRight") answer(true); if (e.code === "ArrowLeft") answer(false); }; addEventListener("keydown", key); F.cleanup = () => removeEventListener("keydown", key);
  reset();
  F.frame = dt => {
    const { g, W, H } = F, cy = H * .36;
    if (st.started && !st.over) { st.card.t += dt; if (st.card.t > st.limit) { st.over = true; st.why = "Too slow: the editor moved on"; st.overAt = Date.now(); st.record = gSave("inbox", st.score); if (st.record) FX.confetti(100); buzz("0,60,40,90"); } }
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#22223b"); sky.addColorStop(1, "#4a4e69"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(214,69,69,.22)"; g.fillRect(0, H * .62, W / 2, H); g.fillStyle = "rgba(42,157,143,.25)"; g.fillRect(W / 2, H * .62, W / 2, H);
    txt(g, "👈 bad news", W * .25, H * .8, "700 17px system-ui", "rgba(255,255,255,.75)"); txt(g, "good news 👉", W * .75, H * .8, "700 17px system-ui", "rgba(255,255,255,.75)");
    txt(g, "tap a side or swipe", W / 2, H * .87, "500 13px system-ui", "rgba(255,255,255,.45)");
    if (st.fly) { st.fly.x += (st.fly.good ? 1 : -1) * 1600 * dt; st.fly.l -= dt; g.globalAlpha = Math.max(0, st.fly.l * 3); drawCard(g, W / 2 + st.fly.x, cy, W, st.fly.text); g.globalAlpha = 1; if (st.fly.l <= 0) st.fly = null; }
    if (st.card && st.started && !st.over) { drawCard(g, W / 2 + st.card.dx, cy, W, st.card.text);
      const left = 1 - st.card.t / st.limit; g.fillStyle = "rgba(255,255,255,.2)"; rrect(g, W * .15, cy + 90, W * .7, 8, 4); g.fillStyle = left > .35 ? "#9ef0c0" : "#ff8080"; rrect(g, W * .15, cy + 90, W * .7 * Math.max(0, left), 8, 4); }
    txt(g, String(st.score), 18, 48, "800 24px system-ui", "#fff", "left"); txt(g, "best " + gBest("inbox") + (st.streak >= 10 ? "   🔥 ×" + (1 + Math.floor(st.streak / 10)) : ""), 18, 70, "600 13px system-ui", "rgba(255,255,255,.75)", "left");
    if (!st.started) { txt(g, "Inbox Sort", W / 2, H * .17, "800 30px system-ui"); txt(g, "Editors' emails arrive faster and faster", W / 2, H * .17 + 32, "500 16px system-ui"); txt(g, "Good news to the right, bad news to the left", W / 2, H * .17 + 56, "500 15px system-ui"); }
    if (st.over) { overText(F, st.why || "Inbox overflow", st.score, gBest("inbox"), st.record, "Tap to open the inbox again"); }
  };
});
function drawCard(g, x, y, W, text) {
  const w = Math.min(340, W * .82); g.fillStyle = "#fff"; rrect(g, x - w / 2, y - 62, w, 124, 14);
  txt(g, "✉ From: Editorial Office", x - w / 2 + 16, y - 34, "600 12px system-ui", "#6b6862", "left");
  const words = text.split(" "), lines = []; let ln = ""; g.font = "700 17px system-ui"; words.forEach(wd => { const t = ln ? ln + " " + wd : wd; if (g.measureText(t).width > w - 32) { lines.push(ln); ln = wd; } else ln = t; }); lines.push(ln);
  lines.slice(0, 3).forEach((l, i) => txt(g, l, x - w / 2 + 16, y - 6 + i * 22, "700 17px system-ui", "#1d1c1a", "left"));
}

/* ---------- the games corner ---------- */
XG.hub = function () {
  const games = [["run", "🏃", "Reviewer 2 Run", "jump over desk rejections", () => +S.settings.gameBest || 0], ["stack", "🧱", "Stack Your CV", "drop sections, keep the overlap", () => gBest("stack")],
    ["catch", "📥", "Catch the Acceptances", "slide to catch the good news", () => gBest("catch")], ["inbox", "✉", "Inbox Sort", "good news right, bad news left", () => gBest("inbox")]];
  openSheet(`<h3><span>🎮 Games</span><button class="ghost" onclick="closeSheet()">✕</button></h3>
    <div class="m">For the long wait between decisions.</div>
    ${games.map(([k, i, t, s, b]) => `<button class="card tap" data-game="${k}" style="width:100%;text-align:left;font:inherit;color:inherit;display:flex;gap:12px;align-items:center"><span style="font-size:30px">${i}</span><span class="grow"><b>${t}</b><br><span class="m">${s}</span></span><span class="m">best<br><b style="color:var(--ink)">${b()}</b></span></button>`).join("")}`);
  $("#sheet").onclick = e => { const b = e.target.closest("[data-game]"); if (!b) return; closeSheet(); ({ run: XB.game, stack: XG.stack, catch: XG.catch, inbox: XG.inbox })[b.dataset.game](); };
};
window.XG = XG;
