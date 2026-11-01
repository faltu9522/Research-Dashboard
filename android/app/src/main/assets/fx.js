// RD SK animations: confetti cannons, fireworks, a paper plane, phoenix embers, tap sparks and banners, drawn on one
// full-screen canvas (no libraries). FX.mode "full" (default) or "calm" (only small sparks and no screen shake).
(function () {
  var FX = window.FX = { mode: "full" };
  var cv = null, cx = null, parts = [], rockets = [], sprites = [], raf = 0, last = 0, W = 0, H = 0, dpr = 1;
  var COLORS = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#9b5de5", "#f15bb5", "#fee440", "#00f5d4", "#ff8c42"];

  function canvas() {
    if (cv) return;
    cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60";
    document.body.appendChild(cv);
    cx = cv.getContext("2d");
    size(); window.addEventListener("resize", size);
  }
  function size() { dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function go() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function calm() { return FX.mode === "calm"; }
  FX.buzz = function (p) { try { if (window.Android && Android.vibrate) Android.vibrate(p); else if (navigator.vibrate) navigator.vibrate(p.split(",").map(Number)); } catch (e) {} };

  function tick(t) {
    var dt = Math.min(0.033, (t - last) / 1000); last = t;
    cx.clearRect(0, 0, W, H);
    // rockets rise, then burst into fireworks
    for (var r = rockets.length - 1; r >= 0; r--) {
      var k = rockets[r]; k.vy += 240 * dt; k.x += k.vx * dt; k.y += k.vy * dt;
      parts.push({ x: k.x, y: k.y, vx: rnd(-20, 20), vy: rnd(10, 40), g: 60, life: 0.4, age: 0, size: 2, color: "#ffe9a8", shape: "dot", drag: 0.9 });
      if (k.vy >= -40) { burst(k.x, k.y, k.color, 70); rockets.splice(r, 1); }
    }
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag || 0.99, dt * 60); p.vy = p.vy * Math.pow(p.drag || 0.99, dt * 60) + (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot = (p.rot || 0) + (p.spin || 0) * dt;
      var a = 1 - p.age / p.life;
      cx.globalAlpha = Math.max(0, Math.min(1, p.fade === false ? 1 : a * 1.4));
      cx.fillStyle = p.color;
      if (p.shape === "rect") {
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.scale(1, Math.cos(p.rot * 2.3)); cx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9); cx.restore();
      } else if (p.shape === "star") {
        star(p.x, p.y, p.size, p.rot);
      } else if (p.shape === "glow") {
        var gr = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); gr.addColorStop(0, p.color); gr.addColorStop(1, "rgba(255,120,40,0)");
        cx.fillStyle = gr; cx.beginPath(); cx.arc(p.x, p.y, p.size, 0, 6.283); cx.fill();
      } else { cx.beginPath(); cx.arc(p.x, p.y, p.size, 0, 6.283); cx.fill(); }
    }
    for (var s = sprites.length - 1; s >= 0; s--) { if (sprites[s].draw(dt) === false) sprites.splice(s, 1); }
    cx.globalAlpha = 1;
    if (parts.length || rockets.length || sprites.length) raf = requestAnimationFrame(tick); else { raf = 0; cx.clearRect(0, 0, W, H); }
  }
  function star(x, y, r, rot) {
    cx.save(); cx.translate(x, y); cx.rotate(rot || 0); cx.beginPath();
    for (var i = 0; i < 10; i++) { var rr = i % 2 ? r * 0.45 : r, an = i * Math.PI / 5; cx.lineTo(Math.sin(an) * rr, -Math.cos(an) * rr); }
    cx.closePath(); cx.fill(); cx.restore();
  }
  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var an = rnd(0, 6.283), sp = rnd(60, 320);
      parts.push({ x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, g: 120, life: rnd(0.9, 1.6), age: 0, size: rnd(1.5, 3.2),
        color: Math.random() < 0.7 ? color : "#ffffff", shape: Math.random() < 0.15 ? "star" : "dot", drag: 0.96, rot: rnd(0, 6) });
    }
  }

  /** Confetti from two cannons at the bottom corners (and a shower from the top). */
  FX.confetti = function (amount) {
    canvas(); amount = amount || (calm() ? 60 : 260);
    [[0, 1], [W, -1]].forEach(function (side) {               // bottom-left fires up-right, bottom-right up-left
      for (var i = 0; i < amount / 2; i++) {
        var th = rnd(55, 82) * Math.PI / 180, sp = rnd(650, 1150);
        parts.push({ x: side[0], y: H - 10, vx: side[1] * Math.cos(th) * sp, vy: -Math.sin(th) * sp, g: 620, drag: 0.985,
          life: rnd(2.2, 3.6), age: 0, size: rnd(4, 8), color: pick(COLORS), shape: Math.random() < 0.8 ? "rect" : "star", rot: rnd(0, 6), spin: rnd(-12, 12) });
      }
    });
    if (!calm()) for (var j = 0; j < amount / 2; j++) parts.push({ x: rnd(0, W), y: rnd(-H * 0.4, -10), vx: rnd(-40, 40), vy: rnd(60, 160), g: 90, drag: 0.99,
      life: rnd(3, 4.5), age: 0, size: rnd(3.5, 7), color: pick(COLORS), shape: "rect", rot: rnd(0, 6), spin: rnd(-8, 8) });
    go();
  };
  /** Fireworks: rockets from the bottom bursting into colour. */
  FX.fireworks = function (n) {
    canvas(); if (calm()) return;
    n = n || 6;
    for (var i = 0; i < n; i++) (function (d) { setTimeout(function () {
      rockets.push({ x: rnd(W * 0.15, W * 0.85), y: H, vx: rnd(-40, 40), vy: -rnd(620, 820), color: pick(COLORS) }); go(); }, d); })(i * rnd(180, 320));
  };
  /** Little sparks where you tapped (Save, Apply…). */
  FX.spark = function (x, y, color) {
    canvas(); if (x == null) { x = W / 2; y = H / 2; }
    for (var i = 0; i < (calm() ? 10 : 26); i++) { var an = rnd(0, 6.283), sp = rnd(80, 260);
      parts.push({ x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, g: 300, drag: 0.94, life: rnd(0.4, 0.8), age: 0, size: rnd(2, 4),
        color: color || pick(COLORS), shape: Math.random() < 0.3 ? "star" : "dot", rot: rnd(0, 6) }); }
    go();
  };
  /** Rising embers (a rejection is not the end). */
  FX.embers = function () {
    canvas(); var n = calm() ? 25 : 90;
    for (var i = 0; i < n; i++) parts.push({ x: rnd(0, W), y: H + rnd(0, 120), vx: rnd(-30, 30), vy: -rnd(90, 260), g: -20, drag: 0.995, life: rnd(1.8, 3.4), age: 0,
      size: rnd(5, 14), color: pick(["rgba(255,170,60,0.95)", "rgba(255,110,40,0.9)", "rgba(255,220,120,0.95)"]), shape: "glow" });
    go();
  };
  /** A paper plane looping across the screen with a sparkle trail. */
  FX.plane = function (fromX, fromY) {
    canvas(); var t = 0, dur = calm() ? 1.1 : 2.1;
    var x0 = fromX != null ? fromX : W * 0.2, y0 = fromY != null ? fromY : H * 0.75;
    var pt = function (u) { // a loop-de-loop: start → up and around → off the top right
      var bx = x0 + (W + 80 - x0) * u, by = y0 + (-80 - y0) * u;
      var loop = calm() ? 0 : Math.sin(u * Math.PI) * 1;
      return { x: bx + Math.sin(u * Math.PI * 2) * 90 * loop, y: by - Math.sin(u * Math.PI) * 140 + (1 - Math.cos(u * Math.PI * 2)) * 60 * loop };
    };
    sprites.push({ draw: function (dt) {
      t += dt; var u = Math.min(1, t / dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      var a = pt(e), b = pt(Math.min(1, e + 0.01)), ang = Math.atan2(b.y - a.y, b.x - a.x);
      for (var i = 0; i < 3; i++) parts.push({ x: a.x, y: a.y, vx: rnd(-30, 30), vy: rnd(-30, 30), g: 40, drag: 0.95, life: rnd(0.4, 0.9), age: 0,
        size: rnd(1.5, 3), color: pick(["#ffffff", "#ffd166", "#4cc9f0"]), shape: Math.random() < 0.3 ? "star" : "dot" });
      cx.save(); cx.translate(a.x, a.y); cx.rotate(ang); cx.globalAlpha = 1;
      cx.fillStyle = "#ffffff"; cx.strokeStyle = "#2f5d8a"; cx.lineWidth = 1.5;
      cx.beginPath(); cx.moveTo(22, 0); cx.lineTo(-16, -13); cx.lineTo(-8, 0); cx.lineTo(-16, 13); cx.closePath(); cx.fill(); cx.stroke();
      cx.beginPath(); cx.moveTo(22, 0); cx.lineTo(-8, 0); cx.lineTo(-12, 7); cx.closePath(); cx.fillStyle = "#cfe0f2"; cx.fill(); cx.stroke();
      cx.restore();
      return u < 1;
    } });
    go();
  };

  /** A big banner in the middle of the screen. */
  FX.banner = function (big, small, color) {
    var el = document.createElement("div");
    el.className = "fx-banner" + (calm() ? " calm" : "");
    el.innerHTML = '<div class="fx-big" style="color:' + (color || "#ffd166") + '">' + big + "</div>" + (small ? '<div class="fx-small">' + small + "</div>" : "");
    document.body.appendChild(el);
    el.addEventListener("click", function () { el.remove(); });
    setTimeout(function () { el.classList.add("out"); }, calm() ? 1400 : 2600);
    setTimeout(function () { el.remove(); }, calm() ? 1900 : 3200);
  };
  FX.shake = function () { if (calm()) return; document.body.classList.remove("fx-shake"); void document.body.offsetWidth; document.body.classList.add("fx-shake"); setTimeout(function () { document.body.classList.remove("fx-shake"); }, 600); };

  /** The moments. */
  FX.accepted = function (journal) {
    FX.buzz("0,60,80,60,80,160");
    FX.confetti(); FX.fireworks(8); setTimeout(function () { FX.confetti(180); }, 900);
    FX.banner("🏆 ACCEPTED!", journal ? "in " + journal : "", "#ffd166");
  };
  FX.submitted = function (journal, x, y) {
    FX.buzz("0,30"); FX.plane(x, y);
    setTimeout(function () { FX.banner("✈️ Sent!", journal ? "to " + journal + " · good luck" : "", "#4cc9f0"); }, calm() ? 200 : 700);
  };
  FX.rejected = function (journal) {
    FX.buzz("0,120"); FX.shake(); FX.embers();
    setTimeout(function () { FX.banner("🔥 Rise again", journal ? journal + " wasn't the one. Your next journal is waiting." : "", "#ff8c42"); }, 350);
  };
  FX.revision = function (journal) {
    FX.buzz("0,40,60,40"); FX.confetti(120); FX.banner("✍️ Revise & resubmit!", journal ? journal + " wants it back: that's a good sign" : "", "#06d6a0");
  };
  FX.streak = function (weeks) { FX.confetti(140); FX.banner("🔥 " + weeks + "-week streak!", "Keep the momentum", "#ff8c42"); };

  /** Numbers on the dashboard count up when they change. */
  FX.countUp = function (root) {
    var seen = FX._seen = FX._seen || {};
    (root || document).querySelectorAll("[data-count]").forEach(function (el) {
      var to = +el.dataset.count, key = el.dataset.key || "", from = seen[key] != null ? seen[key] : 0;
      seen[key] = to;
      if (from === to || calm()) { el.textContent = to; return; }
      var t0 = performance.now(), dur = 900;
      (function step(t) { var u = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - u, 3);
        el.textContent = Math.round(from + (to - from) * e); if (u < 1) requestAnimationFrame(step); })(t0);
    });
  };
})();
