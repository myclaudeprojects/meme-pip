// BTC 15-min tab (owner 2026-11-03): live over/under watcher. Read-only: public Coinbase price only. No orders.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // Backtest 2026-10-03..11-03, 2,999 BTC 15m windows (Binance 1m): P(side BTC is on at T-left wins)
  const BK = [0, 0.02, 0.05, 0.10, 0.15, 0.25, 0.40, 99];
  const WR = { 3: [59.5, 76.4, 91.0, 96.3, 98.2, 99.0, 100], 2: [63.9, 82.8, 93.5, 98.4, 99.2, 99.5, 100], 1: [71.4, 90.0, 98.2, 99.6, 100, 100, 100] };
  const S = { vol: null, price: null, target: null, manual: null, winStart: 0, side: null, flipAt: 0, err: null };
  const fmt = (v) => v == null ? "–" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function winStart(t) { return Math.floor(t / 900000) * 900000; }
  function wr(leftMin, absPct) {
    const k = leftMin <= 1 ? 1 : leftMin <= 2 ? 2 : leftMin <= 3 ? 3 : null; if (!k) return null;
    for (let i = 0; i < BK.length - 1; i++) if (absPct >= BK[i] && absPct < BK[i + 1]) return WR[k][i];
    return 100;
  }
  async function getTarget(ws) {
    try {
      const u = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60";
      const r = await (await fetch(u, { cache: "no-store" })).json(); const c = Array.isArray(r) ? r.find((x) => x[0] * 1000 === ws) : null;
      if (c) S.target = c[3]; // open
    } catch (e) { S.err = "target: " + e.message; }
  }
  async function getVol() {
    // Compare this window's high-low range so far vs the same elapsed minutes in the previous 16 windows (Coinbase 1m candles).
    try {
      const r = await (await fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", { cache: "no-store" })).json();
      if (!Array.isArray(r)) return;
      const now = Date.now(), ws = winStart(now), el = Math.max(1, Math.ceil((now - ws) / 60000));
      const rng = (a) => { if (!a.length) return null; let h = -Infinity, l = Infinity; a.forEach((c) => { h = Math.max(h, c[2]); l = Math.min(l, c[1]); }); return (h - l) / l * 100; };
      const cur = r.filter((c) => c[0] * 1000 >= ws); if (S.price) cur.push([0, S.price, S.price]);
      const past = [];
      for (let k = 1; k <= 16; k++) { const w0 = ws - k * 900000; const a = r.filter((c) => c[0] * 1000 >= w0 && c[0] * 1000 < w0 + el * 60000); if (a.length >= Math.min(el, 3) * 0.6) { const v = rng(a); if (v != null) past.push(v); } }
      const c = rng(cur); if (c == null || past.length < 4) return;
      const avg = past.reduce((x, y) => x + y, 0) / past.length;
      S.vol = { cur: c, avg, ratio: c / avg, el, n: past.length };
    } catch (e) {}
  }
  async function tick() {
    const now = Date.now(), ws = winStart(now);
    if (ws !== S.winStart) { S.winStart = ws; S.target = null; S.manual = null; S.side = null; const inp = $("b15-man"); if (inp) inp.value = ""; await getTarget(ws); }
    else if (S.target == null) await getTarget(ws);
    try { const r = await (await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker")).json(); S.price = Number(r.price); S.err = null; }
    catch (e) { S.err = "price: " + e.message; }
    if (!S.volAt || Date.now() - S.volAt > 10000) { S.volAt = Date.now(); getVol(); }
    render();
  }
  function render() {
    const root = $("b15-root"); if (!root || $("view-btc15").hidden) return;
    const now = Date.now(), left = S.winStart + 900000 - now, lm = left / 60000;
    const tgt = S.manual || S.target, p = S.price;
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    let side = null, pct = null, usd = null;
    if (tgt && p) { usd = p - tgt; pct = (p / tgt - 1) * 100; side = usd >= 0 ? "OVER" : "UNDER"; }
    if (side && S.side && side !== S.side) S.flipAt = now; if (side) S.side = side;
    const w = pct == null ? null : wr(lm, Math.abs(pct));
    const play = lm <= 2.05 && lm > 0.25 && pct != null && Math.abs(pct) >= 0.05;
    const flipped = now - S.flipAt < 10000;
    const col = side === "OVER" ? "#1a7f37" : side === "UNDER" ? "#cf222e" : "#30363d";
    const box = $("b15-box");
    box.style.background = col; box.style.opacity = play || lm <= 3 ? "1" : "0.45";
    box.style.outline = flipped ? "6px solid #f2cc60" : "none";
    $("b15-side").textContent = side ? (play ? side + " — PLAY" : side + (lm > 2.05 ? " — wait for 2:00" : " — too close")) : "–";
    $("b15-left").textContent = left > 0 ? mm + ":" + String(ss).padStart(2, "0") : "0:00";
    $("b15-price").textContent = fmt(p); $("b15-tgt").textContent = fmt(tgt) + (S.manual ? " (yours)" : "");
    $("b15-diff").textContent = usd == null ? "–" : (usd >= 0 ? "+" : "−") + "$" + Math.abs(usd).toFixed(2) + " (" + (pct >= 0 ? "+" : "") + pct.toFixed(3) + "%)";
    $("b15-wr").textContent = w == null ? "shows at 3:00 left" : w.toFixed(1) + "% wins · take it only if payout > " + (100 / w).toFixed(2) + "x";
    $("b15-flip").textContent = flipped ? "FLIPPED" : "";
    $("b15-err").textContent = S.err || "";
    const v = S.vol;
    if (v) {
      const lv = v.ratio < 0.7 ? ["CALM", "#3fb950"] : v.ratio < 1.3 ? ["NORMAL", "#8b949e"] : v.ratio < 2 ? ["HIGH", "#d29922"] : ["WILD", "#f85149"];
      $("b15-vol").textContent = v.ratio.toFixed(1) + "x normal · " + lv[0]; $("b15-vol").style.color = lv[1];
      $("b15-volbar").style.width = Math.min(100, v.ratio / 3 * 100) + "%"; $("b15-volbar").style.background = lv[1];
      $("b15-vols").textContent = "This candle's range so far " + v.cur.toFixed(3) + "% vs " + v.avg.toFixed(3) + "% avg at the same point (first " + v.el + " min) in the last " + v.n + " candles." + (v.ratio >= 1.3 ? " Big swings: only take bigger gaps ($80+)." : "");
    }
  }
  function show(on) { $("view-btc15").hidden = !on; if (on) { if (location.hash !== "#btc15") history.replaceState(null, "", "#btc15"); render(); } else if (location.hash === "#btc15") history.replaceState(null, "", location.pathname + location.search); }
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.view; show(v === "btc15");
    if (v === "btc15") { $("view-main").hidden = true; $("view-bskt").hidden = true; document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("on", x.dataset.view === "btc15")); }
  }));
  window.addEventListener("hashchange", () => { if (location.hash === "#btc15") $("b15tab").click(); });
  $("b15-man").addEventListener("input", (e) => { const v = Number(String(e.target.value).replace(/[$,\s]/g, "")); S.manual = v > 0 ? v : null; render(); });
  if (location.hash === "#btc15") setTimeout(() => $("b15tab").click(), 0);
  tick(); setInterval(tick, 1000); setInterval(render, 250);
})();
