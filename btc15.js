// BTC 15-min tab (owner 2026-11-05): Kalshi KXBTC15M target + multi-exchange BRTI estimate. Read-only. No orders.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const VER = 8;
  // Free Render CORS proxy (whitelist: KXBTC15M markets only). Cold-starts on free tier.
  const KALSHI_PROXY = "https://kalshi-kxbtc15m-proxy.onrender.com/kxbtc15m";
  const _f = window.fetch.bind(window);
  const fetch = (u, o) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000); return _f(u, Object.assign({}, o, { signal: c.signal })).finally(() => clearTimeout(t)); };
  // Backtest 2026-10-03..11-03, 2,999 BTC 15m windows (Binance 1m): P(side BTC is on at T-left wins)
  const BK = [0, 0.02, 0.05, 0.10, 0.15, 0.25, 0.40, 99];
  const WR = { 3: [59.5, 76.4, 91.0, 96.3, 98.2, 99.0, 100], 2: [63.9, 82.8, 93.5, 98.4, 99.2, 99.5, 100], 1: [71.4, 90.0, 98.2, 99.6, 100, 100, 100] };
  const S = {
    vol: null, price: null, price60: null, target: null, targetSrc: null, manual: null,
    winStart: 0, side: null, flipAt: 0, err: null,
    yesAsk: null, noAsk: null, kalshiTicker: null,
    samples: [], // {t, p} for 60s rolling avg
    exch: {}
  };
  const fmt = (v) => v == null ? "–" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCents = (d) => d == null || !isFinite(d) ? "–" : (d * 100).toFixed(1) + "¢";
  function winStart(t) { return Math.floor(t / 900000) * 900000; }
  function wr(leftMin, absPct) {
    const k = leftMin <= 1 ? 1 : leftMin <= 2 ? 2 : leftMin <= 3 ? 3 : null; if (!k) return null;
    for (let i = 0; i < BK.length - 1; i++) if (absPct >= BK[i] && absPct < BK[i + 1]) return WR[k][i];
    return 100;
  }
  // Coinbase's CDN caches the plain candles URL for up to 5 min, so a new window's first candle can be missing. A unique start/end range forces fresh data.
  function candlesUrl(fromMs) { return "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=" + new Date(fromMs).toISOString() + "&end=" + new Date().toISOString(); }

  // CORS-friendly USD spot tickers (constituent / near-constituent of BRTI-like indices). Bitstamp has no CORS.
  const FEEDS = [
    { id: "coinbase", url: "https://api.exchange.coinbase.com/products/BTC-USD/ticker", parse: (j) => Number(j.price) },
    { id: "kraken", url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD", parse: (j) => Number(j && j.result && (j.result.XXBTZUSD || j.result.XBTUSD || Object.values(j.result)[0]).c[0]) },
    { id: "gemini", url: "https://api.gemini.com/v1/pubticker/btcusd", parse: (j) => Number(j.last) },
  ];

  async function getKalshi(ws) {
    try {
      S.kalAt = Date.now();
      const r = await (await fetch(KALSHI_PROXY + "?status=open", { cache: "no-store" })).json();
      const markets = (r && r.markets) || [];
      const endMs = ws + 900000;
      const m = markets.find((x) => {
        const ct = Date.parse(x.close_time);
        return isFinite(ct) && Math.abs(ct - endMs) < 2000;
      }) || markets.find((x) => {
        // Fallback: open_time matches window start
        const ot = Date.parse(x.open_time);
        return isFinite(ot) && Math.abs(ot - ws) < 2000;
      });
      if (m && m.floor_strike != null) {
        S.target = Number(m.floor_strike);
        S.targetSrc = "kalshi";
        S.yesAsk = m.yes_ask_dollars != null ? Number(m.yes_ask_dollars) : (m.yes_ask != null ? Number(m.yes_ask) / 100 : null);
        S.noAsk = m.no_ask_dollars != null ? Number(m.no_ask_dollars) : (m.no_ask != null ? Number(m.no_ask) / 100 : null);
        S.kalshiTicker = m.ticker || null;
        S.err = null;
        return true;
      }
    } catch (e) {
      S.err = "kalshi: " + (e.name === "AbortError" ? "timeout/cold-start" : e.message);
    }
    return false;
  }

  async function getCoinbaseFallback(ws) {
    try {
      S.tgtAt = Date.now();
      const r = await (await fetch(candlesUrl(ws - 600000), { cache: "no-store" })).json();
      const c = Array.isArray(r) ? r.find((x) => x[0] * 1000 === ws) : null;
      if (c) {
        S.target = c[3]; // open
        S.targetSrc = "coinbase-estimate";
      }
    } catch (e) {
      if (!S.err) S.err = "target: " + e.message;
    }
  }

  async function getTarget(ws) {
    const ok = await getKalshi(ws);
    if (!ok && S.targetSrc !== "kalshi") await getCoinbaseFallback(ws);
  }

  async function getVol() {
    // Compare this window's high-low range so far vs the same elapsed minutes in the previous 16 windows (Coinbase 1m candles).
    try {
      const r = await (await fetch(candlesUrl(winStart(Date.now()) - 17 * 900000), { cache: "no-store" })).json();
      if (!Array.isArray(r)) return;
      const now = Date.now(), ws = winStart(now), el = Math.max(1, Math.ceil((now - ws) / 60000));
      const rng = (a) => { if (!a.length) return null; let h = -Infinity, l = Infinity; a.forEach((c) => { h = Math.max(h, c[2]); l = Math.min(l, c[1]); }); return (h - l) / l * 100; };
      const cur = r.filter((c) => c[0] * 1000 >= ws); if (S.price) cur.push([0, S.price, S.price]);
      const past = [];
      for (let k = 1; k <= 16; k++) { const w0 = ws - k * 900000; const a = r.filter((c) => c[0] * 1000 >= w0 && c[0] * 1000 < w0 + el * 60000); if (a.length >= Math.min(el, 3) * 0.6) { const v = rng(a); if (v != null) past.push(v); } }
      const c = rng(cur); if (c == null || past.length < 4) return;
      const avg = past.reduce((x, y) => x + y, 0) / past.length;
      // Safe lead (owner 2026-11-03): how far BTC actually moved over the last 2:00 of each of the last 8 finished candles.
      // Minimum lead = 1.2x the 75th-percentile move (never under $40). Over $150, or this candle WILD (2x+), = too volatile, no PLAY.
      const fin = [];
      for (let k = 1; k <= 8; k++) { const w0 = ws - k * 900000; const a = r.find((x) => x[0] * 1000 === w0 + 780000), b = r.find((x) => x[0] * 1000 === w0 + 840000); if (a && b) fin.push(Math.abs(b[4] - a[3])); }
      let minLead = 40;
      if (fin.length >= 5) { fin.sort((x, y) => x - y); minLead = Math.max(40, Math.ceil(fin[Math.floor(fin.length * 0.75)] * 1.2 / 10) * 10); }
      S.vol = { cur: c, avg, ratio: c / avg, el, n: past.length, minLead, nFin: fin.length, tooVol: minLead > 150 || c / avg >= 2 };
    } catch (e) {}
  }

  async function getSpot() {
    const now = Date.now();
    const results = await Promise.all(FEEDS.map(async (f) => {
      try {
        const j = await (await fetch(f.url, { cache: "no-store" })).json();
        const p = f.parse(j);
        if (isFinite(p) && p > 1000) { S.exch[f.id] = { p, t: now }; return p; }
      } catch (e) {}
      // Keep a recent value briefly if a feed blips
      const prev = S.exch[f.id];
      if (prev && now - prev.t < 15000) return prev.p;
      return null;
    }));
    const ok = results.filter((p) => p != null);
    if (!ok.length) { S.err = (S.err || "") + (S.err ? "; " : "") + "price: all feeds failed"; return; }
    // v8 (owner 2026-11-05): Binance.US/Crypto.com ran $40-70 high and skewed the gap; use the median of Coinbase/Kraken/Gemini (BRTI constituents).
    ok.sort((a, b) => a - b);
    const avg = ok.length % 2 ? ok[(ok.length - 1) / 2] : (ok[ok.length / 2 - 1] + ok[ok.length / 2]) / 2;
    S.price = avg;
    S.samples.push({ t: now, p: avg });
    const cut = now - 60000;
    while (S.samples.length && S.samples[0].t < cut) S.samples.shift();
    if (S.samples.length) {
      S.price60 = S.samples.reduce((a, s) => a + s.p, 0) / S.samples.length;
    }
    // Prefer clearing a price error once feeds work
    if (S.err && S.err.indexOf("price:") === 0) S.err = null;
  }

  async function tick() {
    const now = Date.now(), ws = winStart(now);
    if (ws !== S.winStart) {
      S.winStart = ws; S.target = null; S.targetSrc = null; S.manual = null; S.side = null;
      S.yesAsk = null; S.noAsk = null; S.kalshiTicker = null;
      const inp = $("b15-man"); if (inp) inp.value = "";
      await getTarget(ws);
    } else if (S.targetSrc !== "kalshi" && (!S.kalAt || Date.now() - S.kalAt > 3000)) {
      await getTarget(ws);
    } else if (S.targetSrc === "kalshi" && (!S.kalAt || Date.now() - S.kalAt > 15000)) {
      // Refresh Over/Under asks every 15s
      getKalshi(ws);
    }
    await getSpot();
    if (!S.volAt || Date.now() - S.volAt > 10000) { S.volAt = Date.now(); getVol(); }
    render();
  }

  function targetLabel() {
    if (S.manual) return " (yours)";
    if (S.targetSrc === "kalshi") return " · Kalshi floor_strike";
    if (S.targetSrc === "coinbase-estimate") return " (estimate, Kalshi unavailable)";
    return "";
  }

  function render() {
    const root = $("b15-root"); if (!root || $("view-btc15").hidden) return;
    const now = Date.now(), left = S.winStart + 900000 - now, lm = left / 60000;
    const tgt = S.manual || S.target;
    // Settlement-relevant estimate = rolling 60s avg when available; else live multi-exchange avg.
    // v8: gap uses the LIVE estimate so it matches the app's "current" number; 60s avg shown separately.
    const p = S.price != null ? S.price : S.price60;
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    let side = null, pct = null, usd = null;
    if (tgt && p) { usd = p - tgt; pct = (p / tgt - 1) * 100; side = usd >= 0 ? "OVER" : "UNDER"; }
    if (side && S.side && side !== S.side) S.flipAt = now; if (side) S.side = side;
    const w = pct == null ? null : wr(lm, Math.abs(pct));
    const v = S.vol, minLead = v ? v.minLead : 40, tooVol = !!(v && v.tooVol);
    const play = !tooVol && lm <= 2.05 && lm > 0.25 && pct != null && Math.abs(pct) >= 0.05 && Math.abs(usd) >= minLead;
    const flipped = now - S.flipAt < 10000;
    const col = side === "OVER" ? "#1a7f37" : side === "UNDER" ? "#cf222e" : "#30363d";
    const box = $("b15-box");
    box.style.background = col; box.style.opacity = play || lm <= 3 ? "1" : "0.45";
    box.style.outline = flipped ? "6px solid #f2cc60" : "none";
    $("b15-side").textContent = side ? (play ? side + " — PLAY" : side + (tooVol ? " — SIT OUT" : lm > 2.05 ? " — wait for 2:00" : " — need $" + minLead + "+")) : "–";
    const wn = $("b15-warn"); if (wn) { wn.hidden = !tooVol; wn.textContent = "⚠ MARKET TOO VOLATILE — don't trade these conditions" + (v ? " (needs $" + minLead + "+ lead, this candle " + v.ratio.toFixed(1) + "x normal)" : ""); }
    $("b15-left").textContent = left > 0 ? mm + ":" + String(ss).padStart(2, "0") : "0:00";
    const liveEl = $("b15-price");
    if (liveEl) {
      liveEl.textContent = fmt(S.price);
      const liveSub = $("b15-price-sub");
      if (liveSub) {
        const n = Object.keys(S.exch).filter((k) => S.exch[k] && now - S.exch[k].t < 15000).length;
        liveSub.textContent = "median of " + n + " feeds · estimate of CF BRTI (not official)";
      }
    }
    const p60el = $("b15-price60");
    if (p60el) p60el.textContent = fmt(S.price60);
    $("b15-tgt").textContent = fmt(tgt) + targetLabel();
    const src = $("b15-tgt-src");
    if (src) {
      if (S.manual) src.textContent = "Using your pasted target.";
      else if (S.targetSrc === "kalshi") src.textContent = "Kalshi " + (S.kalshiTicker || "KXBTC15M") + " floor_strike (60s BRTI avg before window).";
      else if (S.targetSrc === "coinbase-estimate") src.textContent = "Coinbase 1m candle open — estimate, Kalshi unavailable.";
      else src.textContent = "Loading Kalshi floor_strike…";
    }
    $("b15-diff").textContent = usd == null ? "–" : (usd >= 0 ? "+" : "−") + "$" + Math.abs(usd).toFixed(2) + " (" + (pct >= 0 ? "+" : "") + pct.toFixed(3) + "%)";
    const diffSub = $("b15-diff-sub");
    if (diffSub) diffSub.textContent = "gap vs live price estimate (median Coinbase/Kraken/Gemini)";
    $("b15-wr").textContent = w == null ? "shows at 3:00 left" : w.toFixed(1) + "% wins · take it only if payout > " + (100 / w).toFixed(2) + "x";
    $("b15-flip").textContent = flipped ? "FLIPPED" : "";
    $("b15-err").textContent = S.err || "";
    const yesEl = $("b15-yes"); if (yesEl) yesEl.textContent = fmtCents(S.yesAsk);
    const noEl = $("b15-no"); if (noEl) noEl.textContent = fmtCents(S.noAsk);
    if (v) {
      const lv = v.ratio < 0.7 ? ["CALM", "#3fb950"] : v.ratio < 1.3 ? ["NORMAL", "#8b949e"] : v.ratio < 2 ? ["HIGH", "#d29922"] : ["WILD", "#f85149"];
      $("b15-vol").textContent = v.ratio.toFixed(1) + "x normal · " + lv[0]; $("b15-vol").style.color = lv[1];
      $("b15-volbar").style.width = Math.min(100, v.ratio / 3 * 100) + "%"; $("b15-volbar").style.background = lv[1];
      $("b15-vols").textContent = "This candle's range so far " + v.cur.toFixed(3) + "% vs " + v.avg.toFixed(3) + "% avg at the same point (first " + v.el + " min) in the last " + v.n + " candles." + " Last 2:00 swings in recent candles mean you need a lead of at least $" + minLead + " at 2:00 left." + (tooVol ? " Too volatile right now: sit out." : "");
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
  // Self-heal: when the phone wakes or the tab comes back, refetch right away.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { S.tgtAt = 0; S.kalAt = 0; S.volAt = 0; if (S.target == null) S.winStart = 0; tick(); } });
  window.addEventListener("focus", () => { S.tgtAt = 0; S.kalAt = 0; tick(); });
  // Auto-reload if a newer version of this tab has been deployed.
  setInterval(async () => { try { const h = await (await fetch("index.html?x=" + Date.now(), { cache: "no-store" })).text(); const m = h.match(/btc15\.js\?v=(\d+)/); if (m && Number(m[1]) > VER && !$("view-btc15").hidden) location.reload(); } catch (e) {} }, 60000);
  tick(); setInterval(tick, 1000); setInterval(render, 250);
})();
