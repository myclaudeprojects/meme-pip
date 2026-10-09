/* Organic loop dashboard - UI (READ-ONLY). Renders public data; never trades or signs. */
(function () {
  "use strict";
  const C = window.OrganicCore, CFG = C.CONFIG;
  const SCAN_MS = 30000, WALLET_MS = 60000, SNAP_MS = 300000;
  // Optional ?minpos=N to change the $5 position threshold (display only).
  const MIN_POS_USD = (() => { const v = Number(new URLSearchParams(location.search).get("minpos")); return Number.isFinite(v) && v > 0 ? v : CFG.POSITION_MIN_USD; })();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");
  // Chart links point at the live pool (PumpSwap first, else deepest-liquidity pair), never the dead pump.fun curve.
  const POOL = {};
  const dex = (mint) => POOL[mint] ? "https://dexscreener.com/solana/" + POOL[mint] : "https://dexscreener.com/solana/" + encodeURIComponent(mint);
  const fixLinks = async () => {
    const links = [...document.querySelectorAll('a[href^="https://dexscreener.com/solana/"]')];
    const mintOf = (a) => decodeURIComponent(a.href.split("/solana/")[1] || "").split(/[?#]/)[0];
    const need = [...new Set(links.map(mintOf).filter((m) => m && m.length > 30 && !POOL[m] && !Object.values(POOL).includes(m)))];
    for (let i = 0; i < need.length; i += 30) {
      try {
        const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + need.slice(i, i + 30).join(","));
        const j = await r.json();
        const by = {};
        for (const p of j.pairs || []) { const m = p.baseToken && p.baseToken.address; if (m) (by[m] = by[m] || []).push(p); }
        for (const [m, ps] of Object.entries(by)) {
          const live = ps.filter((p) => p.dexId !== "pumpfun");
          const pick = live.find((p) => p.dexId === "pumpswap") || live.sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0))[0];
          if (pick) POOL[m] = pick.pairAddress;
        }
      } catch (e) {}
    }
    for (const a of links) { const m = mintOf(a); if (POOL[m]) a.href = "https://dexscreener.com/solana/" + POOL[m]; }
  };
  let fixT = null;
  new MutationObserver(() => { clearTimeout(fixT); fixT = setTimeout(fixLinks, 300); }).observe(document.documentElement, { childList: true, subtree: true });
  const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

  const S = { snap: null, snapSrc: null, scan: null, wallet: null, walletErr: null, arc: null, arcErr: null,
              prices: {}, info: {}, sources: {}, nextScan: 0, nextWallet: 0, nextSnap: 0, busy: false,
              hist: loadHist() };

  function loadHist() { try { return JSON.parse(localStorage.getItem("organicHolderHist") || "{}"); } catch (e) { return {}; } }
  function saveHist() { try { localStorage.setItem("organicHolderHist", JSON.stringify(S.hist)); } catch (e) { /* ignore */ } }
  function pushHist(mint, holders, hc5) {
    if (!holders) return;
    const a = S.hist[mint] || (S.hist[mint] = []);
    const last = a[a.length - 1];
    if (!last || Date.now() - last.t > 25000) a.push({ t: Date.now(), h: holders, hc5 });
    while (a.length > 120) a.shift();
  }
  function setSrc(name, ok, detail) { S.sources[name] = { ok, detail, t: Date.now() }; }

  // ---------- params from snapshot ----------
  function params() {
    const p = (S.snap && S.snap.params) || {};
    return { mcapMin: p.mcap_min || CFG.MCAP_MIN, mcapMax: p.mcap_max || CFG.MCAP_MAX,
             maxPos: p.max_positions || CFG.MAX_POSITIONS, buyUsd: p.buy_usd || CFG.BUY_USD,
             tp: p.tp_multiple || CFG.TP_MULT, early: p.early_exit_prefer_multiple || CFG.EARLY_MULT,
             paused: p.new_buys_paused_until || null };
  }
  function snapPositions() {
    const s = S.snap; if (!s) return [];
    const open = (s.positions || []).map((p) => Object.assign({ _kind: "open" }, p));
    const dust = (s.history || []).filter((p) => p.status === "moonbag").map((p) => Object.assign({ _kind: "dust" }, p));
    const manual = (s.manual_positions || []).map((p) => Object.assign({ _kind: "manual" }, p));
    return open.concat(dust, manual);
  }

  // ---------- loaders ----------
  async function loadSnapshot() {
    try {
      const r = await fetch("positions.json?ts=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      S.snap = await r.json(); S.snapSrc = "positions.json";
    } catch (e) {
      if (window.POSITIONS_SNAPSHOT) { S.snap = window.POSITIONS_SNAPSHOT; S.snapSrc = "positions.js (embedded)"; }
      else { S.snap = null; S.snapSrc = null; }
    }
    setSrc("positions.json snapshot", !!S.snap, S.snap ? "from " + S.snapSrc + ", generated " + S.snap.generated_et : "not found (cost basis unavailable)");
  }

  async function loadScan() {
    const u = await C.scanUniverse();
    const okN = u.sources.filter((s) => s.ok).length;
    setSrc("Jupiter token lists", okN > 0, okN + "/" + u.sources.length + " lists OK" +
      (okN < u.sources.length ? " - failed: " + u.sources.filter((s) => !s.ok).map((s) => s.path + " (" + s.err + ")").join(", ") : ""));
    if (okN > 0) { S.scan = Object.assign({ at: Date.now() }, u); S.scanErr = null; }
    else S.scanErr = u.sources.map((s) => s.err).filter(Boolean)[0] || "no data";
  }

  async function loadWallets() {
    const jobs = [];
    jobs.push(C.getSolWallet().then((w) => { S.wallet = Object.assign({ at: Date.now() }, w); S.walletErr = null;
      setSrc("Solana RPC (SOL balance)", !!w.rpc, w.rpc ? C.hostOf(w.rpc) : "all RPCs failed; SOL from Jupiter holdings");
      setSrc("Token holdings", w.tokensOk, w.tokensOk ? w.tokenSrc + " (" + w.tokens.length + " accounts)" : "unavailable: " + w.warn.join("; ")); })
      .catch((e) => { S.walletErr = e.message; setSrc("Solana RPC (SOL balance)", false, e.message); setSrc("Token holdings", false, e.message); }));
    jobs.push(C.getArcUsdc().then((a) => { S.arc = Object.assign({ at: Date.now() }, a); S.arcErr = null;
      setSrc("Arc RPC", true, C.hostOf(CFG.ARC_RPC) + " via " + a.method); })
      .catch((e) => { S.arcErr = e.message; setSrc("Arc RPC", false, e.message); }));
    await Promise.all(jobs);

    const mints = new Set([CFG.SOL_MINT]);
    for (const t of (S.wallet && S.wallet.tokens) || []) if (t.amount > 0) mints.add(t.mint);
    for (const p of snapPositions()) if (p.mint) mints.add(p.mint);
    try { S.prices = await C.getPrices([...mints]); setSrc("Jupiter price", true, Object.keys(S.prices).length + " prices"); }
    catch (e) { setSrc("Jupiter price", false, e.message); }
    const posMints = [...mints].filter((m) => m !== CFG.SOL_MINT && !CFG.STABLES.includes(m));
    if (posMints.length) {
      try { S.info = Object.assign(S.info, await C.getTokenInfo(posMints)); } catch (e) { /* non-fatal */ }
    }
  }

  // ---------- positions model ----------
  function buildPositions() {
    const snapBy = {}; for (const p of snapPositions()) if (p.mint) snapBy[p.mint] = p;
    const out = [], seen = new Set();
    const tokens = (S.wallet && S.wallet.tokensOk) ? S.wallet.tokens : null;
    if (tokens) {
      for (const t of tokens) {
        if (t.mint === CFG.SOL_MINT || CFG.STABLES.includes(t.mint)) continue;
        const px = S.prices[t.mint]; const value = px != null ? px * t.amount : null;
        if (value == null || value < MIN_POS_USD) continue;
        seen.add(t.mint);
        out.push({ mint: t.mint, amount: t.amount, value, snap: snapBy[t.mint] || null, live: true });
      }
    }
    for (const p of snapPositions()) {
      if ((p._kind !== "open" && p._kind !== "manual") || seen.has(p.mint)) continue;
      const px = S.prices[p.mint];
      out.push({ mint: p.mint, amount: tokens ? 0 : p.tokens_ui, value: tokens ? 0 : (px != null && p.tokens_ui ? px * p.tokens_ui : null),
                 snap: p, live: false, missing: !!tokens });
    }
    return out;
  }

  // ---------- render ----------
  function render() {
    const P = params();
    $("updated").textContent = C.nowEt();
    $("f-sol").innerHTML = `<a href="https://solscan.io/account/${CFG.SOL_WALLET}" target="_blank" rel="noopener">${short(CFG.SOL_WALLET)}</a>`;
    $("f-arc").textContent = short(CFG.ARC_WALLET);
    renderCards(P); const pos = renderPositions(P); renderDecision(P); renderScan(P, pos); renderRanges(); renderSources();
    renderHolderPanel();
  }

  function renderCards(P) {
    const solPx = S.prices[CFG.SOL_MINT];
    if (S.wallet) {
      $("c-sol").textContent = S.wallet.sol.toFixed(4) + " SOL";
      $("c-sol-s").textContent = (solPx ? C.fmtUsd(S.wallet.sol * solPx) + " @ " + C.fmtUsd(solPx) + "/SOL" : "SOL price unavailable") + " · " + short(CFG.SOL_WALLET);
      let tot = 0, n = 0, usdc = 0;
      for (const t of S.wallet.tokens) {
        if (!(t.amount > 0)) continue; n++;
        const px = S.prices[t.mint]; if (px != null) tot += px * t.amount;
        if (t.mint === CFG.STABLES[0]) usdc += t.amount;
      }
      $("c-spl").innerHTML = S.wallet.tokensOk ? esc(C.fmtUsd(tot)) : '<span class="neg">unavailable</span>';
      $("c-spl-s").textContent = (S.wallet.tokensOk ? "" : "token list blocked: " + S.wallet.warn.join("; ") + " · ") + n + " non-empty token mints · USDC " + usdc.toFixed(2) + (solPx ? " · Sol cash ≈ " + C.fmtUsd(S.wallet.sol * solPx + usdc) : "");
    } else {
      $("c-sol").innerHTML = '<span class="neg">unavailable</span>'; $("c-sol-s").textContent = S.walletErr || "loading…";
      $("c-spl").innerHTML = '<span class="neg">unavailable</span>'; $("c-spl-s").textContent = S.walletErr ? "Solana RPC blocked/unreachable from this browser" : "loading…";
    }
    if (S.arc) { $("c-arc").textContent = C.fmtUsd(S.arc.usdc); $("c-arc-s").textContent = short(CFG.ARC_WALLET) + " · chain " + CFG.ARC_CHAIN_ID; }
    else { $("c-arc").innerHTML = '<span class="neg">unavailable</span>'; $("c-arc-s").textContent = S.arcErr || "loading…"; }
    $("c-strat").textContent = `$${(P.mcapMin / 1e3).toFixed(0)}k–$${(P.mcapMax / 1e6).toFixed(1)}M · TP ${P.tp}× · max ${P.maxPos}`;
    $("c-strat-s").textContent = `$${P.buyUsd} buys from Sol cash · early full sell on first holder slowdown (prefer ~${P.early}×)` + (P.paused ? " · new buys paused until " + P.paused : "");
  }

  function spark(mint) {
    const a = (S.hist[mint] || []).slice(-40); if (a.length < 2) return '<span class="muted">collecting…</span>';
    const hs = a.map((x) => x.h), lo = Math.min(...hs), hi = Math.max(...hs), w = 110, h = 26;
    const pts = a.map((x, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 2 - (hi === lo ? 0.5 : (x.h - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`).join(" ");
    const col = hs[hs.length - 1] >= hs[0] ? "#3fb950" : "#f85149";
    return `<svg class="spark" width="${w}" height="${h}"><polyline fill="none" stroke="${col}" stroke-width="1.6" points="${pts}"/></svg>`;
  }

  function holderSignal(mint, info) {
    const a = S.hist[mint] || [];
    const prev = a.length >= 2 ? a[a.length - 2] : null, cur = a[a.length - 1];
    const sig = [];
    if (info) { if (info.hc5 <= 0) sig.push("5m holders " + C.fmtPct(info.hc5)); if (info.hc1 <= 0) sig.push("1h holders " + C.fmtPct(info.hc1)); }
    if (prev && cur && cur.h < prev.h) sig.push("holders down vs last poll (" + prev.h + "→" + cur.h + ")");
    return sig.length ? `<span class="warn">Slowdown signal: ${esc(sig.join(", "))}. The bot exits early on the first slowdown</span>`
                      : (info ? '<span class="pos">Holder growth still rising</span>' : '<span class="muted">no holder data</span>');
  }

  function renderPositions(P) {
    const pos = buildPositions();
    const organic = pos.filter((p) => !(p.snap && (p.snap._kind === "dust" || p.snap._kind === "manual")) && p.mint !== CFG.FRANK);
    $("c-pos").textContent = organic.length + " / " + P.maxPos;
    $("c-pos-s").textContent = (S.wallet && S.wallet.tokensOk) ? "inferred from on-chain holdings > $" + MIN_POS_USD + " (excl. SOL/USDC)" : "on-chain holdings unavailable; using snapshot";
    $("pos-note").textContent = S.snap ? "cost basis from positions.json (" + (S.snap.generated_et || "?") + ")" : "no positions.json, so value only";
    if (!pos.length) {
      $("positions").innerHTML = `<div class="msg ok">No open positions${S.wallet && S.wallet.tokensOk ? " (no SPL holding worth more than $" + MIN_POS_USD + " besides SOL/USDC)" : ""}.</div>` +
        (S.walletErr ? `<div class="msg err">Wallet read failed: ${esc(S.walletErr)}</div>` : "");
      return pos;
    }
    let html = '<div class="wrap"><table><thead><tr><th class="l">Token</th><th>Tokens held</th><th>Value</th><th>Cost</th><th>Multiple</th><th class="l">Progress to TP</th><th>Holders</th><th>Δ5m</th><th>Δ1h</th><th class="l">Trend</th></tr></thead><tbody>';
    for (const p of pos) {
      const info = S.info[p.mint]; if (info) pushHist(p.mint, info.holders, info.hc5);
      const sym = (info && info.symbol) || (p.snap && p.snap.symbol) || short(p.mint);
      const cost = p.snap && p.snap.cost_usd; const tp = (p.snap && p.snap._kind === "open") ? P.tp : (p.snap && p.snap.tp_multiple) || P.tp;
      const mult = cost && p.value != null ? p.value / cost : null;
      let bar = '<span class="muted">cost unknown client-side</span>';
      if (mult != null) {
        const w = Math.max(0, Math.min(1, mult / tp)) * 100;
        bar = `<div class="bar" title="${mult.toFixed(2)}× of ${tp}× target"><i class="${mult < 1 ? "down" : ""}" style="width:${w.toFixed(1)}%"></i>` +
              `<b class="one" style="left:${(100 / tp).toFixed(1)}%" title="1.0× (cost)"></b><b style="left:${(100 * P.early / tp).toFixed(1)}%" title="${P.early}× early-exit preference"></b></div>` +
              `<div class="muted" style="font-size:11px">${p.snap._kind === "manual" ? "Exit" : "TP"} at ${C.fmtUsd(cost * tp)} (${Number(tp).toFixed(tp >= 10 ? 0 : 1)}×)${p.snap.entry_mc ? " · entry MC $" + C.fmtK(p.snap.entry_mc) + " → TP MC ≈ $" + C.fmtK(p.snap.entry_mc * tp) : ""}</div>`;
      }
      const tag = p.mint === CFG.FRANK ? ' <span class="badge HELD">FRANK, separate</span>' : (p.snap && p.snap._kind === "dust") ? ' <span class="badge SKIP">legacy dust</span>' : (p.snap && p.snap._kind === "manual") ? ' <span class="badge HELD">manual hold</span>' : "";
      const miss = p.missing ? '<div class="warn" style="font-size:11px">In snapshot as open but not in wallet now (likely sold since snapshot)</div>' : (!p.live ? '<div class="muted" style="font-size:11px">value from snapshot token amount × live price</div>' : "");
      html += `<tr><td class="l"><a href="${dex(p.mint)}" target="_blank" rel="noopener">${esc(sym)}</a>${tag}${miss}</td>` +
        `<td>${p.amount != null ? Number(p.amount).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "-"}</td><td>${C.fmtUsd(p.value)}</td><td>${cost ? C.fmtUsd(cost) : "-"}</td>` +
        `<td class="${mult == null ? "muted" : mult >= 1 ? "pos" : "neg"}">${mult == null ? "-" : mult.toFixed(2) + "×"}</td>` +
        `<td class="l">${bar}</td><td>${info ? info.holders.toLocaleString() : "-"}</td>` +
        `<td class="${cls(info && info.hc5)}">${info ? C.fmtPct(info.hc5) : "-"}</td><td class="${cls(info && info.hc1)}">${info ? C.fmtPct(info.hc1) : "-"}</td>` +
        `<td class="l"><a href="#" class="spark-link" data-mint="${esc(p.mint)}" title="Click for holder details">${spark(p.mint)}</a><div style="font-size:11px">${holderSignal(p.mint, info)}</div></td></tr>`;
    }
    html += "</tbody></table></div>";
    if (S.walletErr) html += `<div class="msg err">Live wallet read failed (${esc(S.walletErr)}). Rows above come from the snapshot.</div>`;
    $("positions").innerHTML = html; saveHist();
    return pos;
  }

  // ---------- holder detail panel (click the trend line) ----------
  let openMint = null;
  const tfmt = (t) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
  function newHoldersBetween(a, fromT, toT) {
    const pts = a.filter((x) => x.t >= fromT && x.t <= toT); if (pts.length < 2) return null;
    return pts[pts.length - 1].h - pts[0].h;
  }
  function bigChart(a) {
    if (a.length < 2) return '<div class="muted">Collecting history. A point is saved about every minute while this page is open.</div>';
    const W = 640, H = 200, L = 52, R = 10, T = 10, B = 26;
    const hs = a.map((x) => x.h), lo = Math.min(...hs), hi = Math.max(...hs), t0 = a[0].t, t1 = a[a.length - 1].t;
    const X = (t) => L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - L - R);
    const Y = (h) => T + (hi === lo ? 0.5 : 1 - (h - lo) / (hi - lo)) * (H - T - B);
    const col = hs[hs.length - 1] >= hs[0] ? "#3fb950" : "#f85149";
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#30363d" stroke-dasharray="3 3"/><text x="${L - 6}" y="${(y + 4).toFixed(1)}" fill="#8b949e" font-size="11" text-anchor="end">${Math.round(v).toLocaleString()}</text>`; }
    g += `<text x="${L}" y="${H - 6}" fill="#8b949e" font-size="11">${tfmt(t0)}</text><text x="${W - R}" y="${H - 6}" fill="#8b949e" font-size="11" text-anchor="end">${tfmt(t1)} ET</text>`;
    const pts = a.map((x) => `${X(x.t).toFixed(1)},${Y(x.h).toFixed(1)}`).join(" ");
    const dots = a.map((x, i) => { const d = i ? x.h - a[i - 1].h : 0;
      return `<circle cx="${X(x.t).toFixed(1)}" cy="${Y(x.h).toFixed(1)}" r="3" fill="${col}"><title>${tfmt(x.t)} ET: ${x.h.toLocaleString()} holders (${d >= 0 ? "+" : ""}${d})</title></circle>`; }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto">${g}<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts}"/>${dots}</svg>`;
  }
  function renderHolderPanel() {
    if (!openMint) return;
    const m = openMint, info = S.info[m], a = S.hist[m] || [];
    const sym = (info && info.symbol) || short(m), now = Date.now();
    const last5 = newHoldersBetween(a, now - 5 * 60000, now), prev5 = newHoldersBetween(a, now - 10 * 60000, now - 5 * 60000);
    let pace = '<span class="muted">Needs about 10 minutes of history on this page.</span>';
    if (last5 != null && prev5 != null) {
      const slow = (prev5 >= 4 && last5 < prev5 * 0.5) || last5 <= 0;
      pace = `<b>${last5 >= 0 ? "+" : ""}${last5}</b> new holders in the last 5 min vs <b>${prev5 >= 0 ? "+" : ""}${prev5}</b> in the 5 min before. ` +
        (slow ? '<span class="warn">Pace is slowing.</span>' : '<span class="pos">Pace is holding up.</span>');
    } else if (last5 != null) pace = `<b>${last5 >= 0 ? "+" : ""}${last5}</b> new holders in the last 5 min (not enough history yet for the prior 5 min).`;
    const first = a[0], cur = a[a.length - 1];
    const sess = first && cur ? `${(cur.h - first.h >= 0 ? "+" : "")}${(cur.h - first.h).toLocaleString()} since ${tfmt(first.t)} ET` : "-";
    const stat = (k, v, c) => `<div class="hstat"><div class="muted">${k}</div><div class="${c || ""}">${v}</div></div>`;
    let h = `<div class="hp-head"><h2 style="margin:0">${esc(sym)} holders</h2><button id="hp-close" title="Close">✕</button></div>`;
    h += '<div class="hstats">' +
      stat("Holders now", info ? info.holders.toLocaleString() : (cur ? cur.h.toLocaleString() : "-")) +
      stat("Change on this page", sess) +
      stat("Holders Δ5m", info ? C.fmtPct(info.hc5) : "-", cls(info && info.hc5)) +
      stat("Holders Δ1h", info ? C.fmtPct(info.hc1) : "-", cls(info && info.hc1)) +
      stat("Holders Δ6h", info ? C.fmtPct(info.hc6) : "-", cls(info && info.hc6)) +
      stat("Holders Δ24h", info ? C.fmtPct(info.hc24) : "-", cls(info && info.hc24)) +
      stat("Organic buyers 1h", info ? info.nob1.toLocaleString() : "-") +
      stat("Organic buy share 1h", info && info.orgBuyPct != null ? info.orgBuyPct.toFixed(0) + "%" : "-") +
      stat("Organic score", info ? info.org.toFixed(1) + (info.orgLabel ? " (" + esc(info.orgLabel) + ")" : "") : "-") +
      stat("Top holders own", info && info.topHolders != null ? info.topHolders.toFixed(1) + "%" : "-") +
      stat("Market cap", info ? "$" + C.fmtK(info.mcap) : "-") +
      stat("Liquidity", info ? "$" + C.fmtK(info.liq) : "-") + "</div>";
    h += `<div style="margin:10px 0;font-size:13px">${pace}</div>`;
    h += bigChart(a.slice(-120));
    const rows = a.slice(-15).reverse();
    if (rows.length) {
      h += '<table style="margin-top:10px"><thead><tr><th class="l">Time (ET)</th><th>Holders</th><th>Change</th><th>Jupiter Δ5m</th></tr></thead><tbody>';
      rows.forEach((x, i) => { const p = a[a.length - 1 - i - 1]; const d = p ? x.h - p.h : null;
        h += `<tr><td class="l">${tfmt(x.t)}</td><td>${x.h.toLocaleString()}</td><td class="${cls(d)}">${d == null ? "-" : (d >= 0 ? "+" : "") + d}</td><td class="${cls(x.hc5)}">${x.hc5 == null ? "-" : C.fmtPct(x.hc5)}</td></tr>`; });
      h += "</tbody></table>";
    }
    h += `<div style="margin-top:10px;font-size:13px"><a href="https://solscan.io/token/${encodeURIComponent(m)}#holders" target="_blank" rel="noopener">Full holder list on Solscan</a> · <a href="${dex(m)}" target="_blank" rel="noopener">Chart</a></div>`;
    h += '<div class="muted" style="margin-top:6px;font-size:11px">The history is saved in this browser while the page is open, so gaps mean the page was closed.</div>';
    $("holder-panel-body").innerHTML = h;
    $("hp-close").onclick = closeHolder;
  }
  function openHolder(mint) { openMint = mint; $("holder-panel").style.display = "flex"; renderHolderPanel(); }
  function closeHolder() { openMint = null; $("holder-panel").style.display = "none"; }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest(".spark-link");
    if (a) { e.preventDefault(); openHolder(a.dataset.mint); return; }
    if (e.target.id === "holder-panel") closeHolder();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMint) closeHolder(); });

  function renderDecision(P) {
    const s = S.snap;
    if (!s) { $("decision").innerHTML = '<div class="msg">positions.json not found. On the bot box, run <code>python3 dashboard_snapshot.py</code> and copy dashboard/positions.json here to see the bot\'s last decision and cost basis.</div>'; $("snap-age").textContent = ""; return; }
    const d = s.last_decision || {};
    $("snap-age").textContent = "snapshot " + (s.generated_et || "?") + (S.snapSrc ? " · " + S.snapSrc : "");
    let h = "";
    if (d.last_skip_reason) h += `<div class="pre">${esc(d.last_skip_reason)}</div>`;
    h += '<div style="margin-top:8px;font-size:13px">';
    if (d.last_scan_et) h += `<div>Last bot scan: <b>${esc(d.last_scan_et)}</b> · ${esc(d.last_scan_n_in_band)} in band` +
      (d.last_scan_best && d.last_scan_best.symbol ? ` · top: <a href="${dex(d.last_scan_best.mint)}" target="_blank" rel="noopener">${esc(d.last_scan_best.symbol)}</a> ($${C.fmtK(d.last_scan_best.mcap)})` : "") + "</div>";
    if (d.last_buy && d.last_buy.symbol) h += `<div>Last buy: <b>${esc(d.last_buy.symbol)}</b> ${C.fmtUsd(d.last_buy.cost_usd)} at ${esc(d.last_buy.as_of_et)}</div>`;
    const hist = (s.history || []).filter((x) => x.status === "closed");
    if (hist.length) h += "<div style='margin-top:6px' class='muted'>Closed: " + hist.map((x) => esc(x.symbol) + (x.pnl_usd != null ? ` (<span class="${cls(x.pnl_usd)}">${x.pnl_usd >= 0 ? "+" : ""}${C.fmtUsd(x.pnl_usd)}</span>)` : "")).join(", ") + "</div>";
    if (s.cash_snapshot && s.cash_snapshot.as_of_et) h += `<div class="muted">Bot cash note (${esc(s.cash_snapshot.as_of_et)}): ${esc(s.cash_snapshot.note || "")}</div>`;
    h += "</div>";
    $("decision").innerHTML = h;
  }

  function evalCtx(pos) {
    const s = S.snap || {};
    return { excludeMints: [...new Set([...(s.exclude_mints || []), ...CFG.EXCLUDE_MINTS])],
             excludeSymbols: [...new Set([...(s.exclude_symbols || []), ...CFG.EXCLUDE_SYMBOLS])],
             heldMints: (pos || []).filter((p) => p.live).map((p) => p.mint) };
  }

  function renderScan(P, pos) {
    const tb = document.querySelector("#scan tbody");
    if (!S.scan) { tb.innerHTML = `<tr><td class="l" colspan="16"><div class="msg err">Scan unavailable: ${esc(S.scanErr || "loading…")}. Jupiter token API blocked or unreachable from this browser.</div></td></tr>`; return; }
    const ctx = evalCtx(pos);
    const rows = S.scan.cands.filter((c) => c.mcap >= P.mcapMin && c.mcap <= P.mcapMax).map((c) => ({ c, e: C.evaluate(c, ctx) }));
    const rank = { PASS: 0, HELD: 1, SKIP: 2 };
    rows.sort((a, b) => rank[a.e.verdict] - rank[b.e.verdict] || b.c.score - a.c.score);
    const nPass = rows.filter((r) => r.e.verdict === "PASS").length;
    $("scan-note").textContent = `${rows.length} candidates in band · ${nPass} PASS · universe ${S.scan.cands.length} tokens · scanned ${C.nowEt(new Date(S.scan.at))}`;
    const organicOpen = (pos || []).filter((p) => p.live && !(p.snap && p.snap._kind === "dust") && p.mint !== CFG.FRANK).length;
    const best = rows.find((r) => r.e.verdict === "PASS");
    $("top-pass").innerHTML = best
      ? `<div class="msg ok">Top PASS right now: <b>${esc(best.c.symbol)}</b> ($${C.fmtK(best.c.mcap)} MC). ${organicOpen >= P.maxPos ? "Max positions reached, so the bot would not add." : "Information only. The bot makes its own decision on its next scan."}</div>`
      : `<div class="msg">Nothing passes all rules right now, so the bot would skip.</div>`;
    if (!rows.length) { tb.innerHTML = '<tr><td class="l muted" colspan="16">No tokens in the band in the current Jupiter lists.</td></tr>'; return; }
    tb.innerHTML = rows.map(({ c, e }) => {
      const top = c.topHolders == null ? "-" : c.topHolders.toFixed(0) + "%";
      return `<tr><td class="l"><span class="badge ${e.verdict}">${e.verdict}</span></td>` +
        `<td class="l"><a href="${dex(c.id)}" target="_blank" rel="noopener" title="${esc(c.name)} · ${esc(c.id)}">${esc(c.symbol)}</a></td>` +
        `<td>$${C.fmtK(c.mcap)}</td><td>$${C.fmtK(c.liq)}</td><td>${c.holders.toLocaleString()}</td>` +
        `<td class="${cls(c.hc5)}">${C.fmtPct(c.hc5)}</td><td class="${cls(c.hc1)}">${C.fmtPct(c.hc1)}</td>` +
        `<td class="${cls(c.hc6)}">${C.fmtPct(c.hc6)}</td><td class="${cls(c.hc24)}">${C.fmtPct(c.hc24)}</td>` +
        `<td>${c.nob1}</td><td class="${c.orgBuyPct == null || c.orgBuyPct < C.RULES.minOrgBuyPct ? "neg" : "pos"}">${c.orgBuyPct == null ? "-" : c.orgBuyPct.toFixed(1) + "%"}</td>` +
        `<td class="${c.pc1 > C.RULES.maxPc1 ? "warn" : cls(c.pc1)}">${C.fmtPct(c.pc1, 1)}</td>` +
        `<td class="${c.topHolders > C.RULES.maxTopHolders ? "neg" : ""}">${top}</td>` +
        `<td class="${c.poolAgeMin != null && c.poolAgeMin < C.RULES.minPoolAgeMin ? "warn" : ""}">${C.fmtAge(c.poolAgeMin)}</td>` +
        `<td>${c.org.toFixed(0)}</td><td class="reason">${e.reasons.map(esc).join(" · ")}</td></tr>`;
    }).join("");
  }

  function renderRanges() {
    if (!S.scan) { $("ranges").innerHTML = '<span class="muted">waiting for scan…</span>'; return; }
    const b = C.bucketSummary(S.scan.cands, [[200e3, 500e3], [500e3, 1e6], [1e6, 2e6], [2e6, 5e6]]);
    let h = '<table><thead><tr><th class="l">Range</th><th>Total</th><th>Rising holders</th><th class="l">Top rising (hc5 / hc1 / org buy %)</th></tr></thead><tbody>';
    for (const r of b) {
      const lbl = (v) => v >= 1e6 ? "$" + v / 1e6 + "M" : "$" + v / 1e3 + "k";
      const band = r.hi <= 1e6 ? ' <span class="muted">(entry band)</span>' : "";
      h += `<tr><td class="l">${lbl(r.lo)}–${lbl(r.hi)}${band}</td><td>${r.total}</td><td>${r.rising}</td><td class="reason">` +
        (r.top.length ? r.top.slice(0, 4).map((c) => `<a href="${dex(c.id)}" target="_blank" rel="noopener">${esc(c.symbol)}</a> <span class="muted">$${C.fmtK(c.mcap)} ${C.fmtPct(c.hc5)}/${C.fmtPct(c.hc1, 1)}/${c.orgBuyPct == null ? "-" : c.orgBuyPct.toFixed(0) + "%"}</span>`).join(" · ") : '<span class="muted">none</span>') + "</td></tr>";
    }
    $("ranges").innerHTML = h + "</tbody></table>";
  }

  function renderSources() {
    $("sources").innerHTML = Object.entries(S.sources).map(([k, v]) => `<span class="chip ${v.ok ? "ok" : "bad"}" title="${esc(v.detail)}">${esc(k)}: ${esc(v.detail)}</span>`).join("") || '<span class="muted">loading…</span>';
    const R = C.RULES;
    $("rules").textContent = `SKIP rules: exclude lists · organic score ≤ 0 · holders not rising (5m or 1h ≤ 0) or ~flat 5m (< ${R.minHc5Flat}%) · holders falling 6h · ` +
      `pool < ${R.minPoolAgeMin} min · organic buy share < ${R.minOrgBuyPct}% · 1h price > +${R.maxPc1}% · top holders > ${R.maxTopHolders}% · < ${R.minNob1} organic buyers 1h · price > $1 · tokenized securities.`;
    const blocked = Object.entries(S.sources).filter(([k, v]) => !v.ok && k !== "positions.json snapshot");
    $("banner").innerHTML = blocked.length ? `<div class="msg err">Some live sources failed from this browser: ${blocked.map(([k, v]) => esc(k) + " (" + esc(v.detail) + ")").join("; ")}. ` +
      `If it says CORS/blocked, try disabling ad/privacy blockers for localhost, or run via serve.py instead of opening the file directly.</div>` : "";
  }

  // ---------- loop ----------
  async function tick(force) {
    if (S.busy) return; S.busy = true;
    const now = Date.now(), jobs = [];
    try {
      if (force || now >= S.nextSnap) { S.nextSnap = now + SNAP_MS; await loadSnapshot(); }
      if (force || now >= S.nextWallet) { S.nextWallet = now + WALLET_MS; jobs.push(loadWallets().catch((e) => console.warn(e))); }
      if (force || now >= S.nextScan) { S.nextScan = now + SCAN_MS; jobs.push(loadScan().catch((e) => { S.scanErr = e.message; })); }
      await Promise.all(jobs);
      render();
    } finally { S.busy = false; }
  }
  setInterval(() => {
    const s = Math.max(0, Math.round((S.nextScan - Date.now()) / 1000));
    $("countdown").textContent = S.busy ? "refreshing…" : "next scan in " + s + "s";
    if (!S.busy && Date.now() >= Math.min(S.nextScan, S.nextWallet)) tick(false);
  }, 1000);
  $("refresh").addEventListener("click", () => tick(true));
  tick(true);
})();
