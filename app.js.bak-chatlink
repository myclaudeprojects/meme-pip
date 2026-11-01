/* Organic loop dashboard - UI (READ-ONLY). Renders public data; never trades or signs. */
(function () {
  "use strict";
  const C = window.OrganicCore, CFG = C.CONFIG;
  const SCAN_MS = 30000, WALLET_MS = 60000, SNAP_MS = 20000, LIVE_PX_MS = 5000;
  // Bordrless bonding-curve pools (no Jupiter/DexScreener price, no CORS on the Bordrless API): price is read from the
  // public pool account: u64 LE baseReserve@210, quoteReserve@218, virtualBase@226, virtualQuote@234; base 6 dp, quote SOL 9 dp.
  const BORDRLESS_POOLS = { mN8pEpVV4z7kvRS8QFWAmxKdAoKbLXPkdMHVuQgxFr5: "5o1GdVhDTPtHnZW3eBum35xcZrpaBjf8VDHJ48KAvRYp",
                            "4iWwcHf9tH6J6UjRgG9rXosXVxNdcKUFuqh1rbps6H7J": "ECrzqrmb7b7d8K3hpiztg2UMGYakR4dKiiTEmivS894X" };
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
  // Owner 2026-10-11 7:28pm ET: scanner shows only coins whose main (deepest live) pool trades against SOL.
  const QUOTE = {}; let quoteBusy = false;
  async function ensureQuotes(ids) {
    const need = ids.filter((m) => m && !(m in QUOTE));
    if (!need.length || quoteBusy) return false; quoteBusy = true; let got = false;
    try {
      for (let i = 0; i < need.length; i += 30) {
        try {
          const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + need.slice(i, i + 30).join(","));
          const j = await r.json(); const by = {};
          for (const p of j.pairs || []) { if (p.chainId && p.chainId !== "solana") continue; const m = p.baseToken && p.baseToken.address; if (m) (by[m] = by[m] || []).push(p); }
          for (const m of need.slice(i, i + 30)) {
            const live = (by[m] || []).filter((p) => p.dexId !== "pumpfun");
            const pick = live.sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0))[0];
            QUOTE[m] = pick ? String((pick.quoteToken || {}).symbol || "").toUpperCase() : null; got = true;
          }
        } catch (e) {}
      }
    } finally { quoteBusy = false; }
    return got;
  }
  const notSol = (m) => QUOTE[m] != null && QUOTE[m] !== "SOL" && QUOTE[m] !== "WSOL";

  const S = { snap: null, snapSrc: null, scan: null, wallet: null, walletErr: null, arc: null, arcErr: null,
              prices: {}, info: {}, sources: {}, nextScan: 0, nextWallet: 0, nextSnap: 0, busy: false,
              pxSrc: {}, pxAt: 0, pxBusy: false, pxErr: null,
              hist: loadHist() };

  function loadHist() { try { return JSON.parse(localStorage.getItem("organicHolderHist") || "{}"); } catch (e) { return {}; } }
  function saveHist() { try { localStorage.setItem("organicHolderHist", JSON.stringify(S.hist)); } catch (e) { /* ignore */ } }
  function pushHist(mint, holders, hc5) {
    if (!holders) return;
    const a = S.hist[mint] || (S.hist[mint] = []);
    const last = a[a.length - 1];
    if (!last || Date.now() - last.t > 25000) a.push({ t: Date.now(), h: holders, hc5 });
    if (a.length > 1500) thinLocal(a);
  }
  // Keep the whole lifetime in this browser too: full detail for 6h, then 1 point / 5 min (6-48h), 1 / 30 min older.
  function thinLocal(a) {
    const now = Date.now(), seen = new Set(), out = [];
    for (const x of a) { const age = now - x.t;
      if (age <= 6 * 3600e3) { out.push(x); continue; }
      const b = age <= 48 * 3600e3 ? 300e3 : 1800e3, k = b + ":" + Math.floor(x.t / b);
      if (!seen.has(k)) { seen.add(k); out.push(x); } }
    a.splice(0, a.length, ...out);
  }
  // Lifetime series for a mint: measured = box recorder (positions.json holder_history.m) + this browser's samples;
  // derived = back-calculated from Jupiter holderChange % windows; start = token launch time.
  function holderSeries(mint) {
    const hh = (S.snap && S.snap.holder_history && S.snap.holder_history[mint]) || {};
    const by = new Map();
    for (const [t, h] of hh.m || []) by.set(Math.round(t / 20) * 20000, { t: t * 1000, h, src: "box" });
    for (const x of S.hist[mint] || []) by.set(Math.round(x.t / 20000) * 20000, { t: x.t, h: x.h, hc5: x.hc5, src: "page" });
    const m = [...by.values()].sort((a, b) => a.t - b.t);
    const d = (hh.d || []).map(([t, h]) => ({ t: t * 1000, h, src: "derived" })).sort((a, b) => a.t - b.t);
    const all = m.concat(d).sort((a, b) => a.t - b.t);
    const created = hh.created_ts ? hh.created_ts * 1000 : null;
    return { m, d, all, created, start: created || (all[0] && all[0].t) || null };
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
    const manual = (s.manual_positions || []).filter((p) => !String(p.mint || "").startsWith("VIRTUALTRADE-PERP")).map((p) => Object.assign({ _kind: "manual" }, p));
    return open.concat(dust, manual);
  }
  // virtualtrade.app perp positions: separate model (equity = margin + notional x (px/entry - 1)), never token rows
  function perpList() { const s = S.snap; return ((s && s.perp_positions) || []).filter((p) => p.onchain_alive !== false); }

  // ---------- loaders ----------
  async function loadSnapshot() {
    try {
      const r = await fetch("positions.json?ts=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const prevGen = S.snap && S.snap.generated_et;
      S.snap = await r.json(); S.snapSrc = "positions.json";
      if (prevGen && prevGen !== S.snap.generated_et) S.nextWallet = 0; // new buy/sell on the box: re-read holdings now
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

  // Wallet holdings: the FRESHEST on-chain source wins. Candidates: positions.json wallet_onchain (box dashboard_snapshot.py,
  // getTokenAccountsByOwner SPL+Token-2022 + Bordrless holdings) and live.json (box live_snapshot.py). A box source older than
  // BOX_STALE_MS is not trusted for holdings (a stale file once showed a sold bag as a phantom row); then the browser reads the
  // chain itself (RPC first, Jupiter fallback). Zero balances are always dropped.
  const BOX_STALE_MS = 15 * 60 * 1000;
  function boxWalletCandidates() {
    const c = [];
    const wo = S.snap && S.snap.wallet_onchain;
    if (wo && wo.ok && Array.isArray(wo.tokens)) c.push({ ts: Number(wo.generated_ts) || 0, et: wo.generated_et, label: "box on-chain snapshot (positions.json)",
      sol: Number(wo.sol) || 0, tokens: wo.tokens, prices: wo.prices || {} });
    const L = S.live;
    if (L && L.sol_wallet) c.push({ ts: Number(L.generated_ts) || 0, et: L.generated_et, label: "box live.json", sol: Number(L.sol_wallet.sol) || 0,
      tokens: L.sol_wallet.tokens || [], prices: {} });
    return c.sort((a, b) => b.ts - a.ts);
  }
  async function loadLive() {
    try { const r = await fetch("live.json?ts=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); S.live = await r.json(); }
    catch (e) { if (!S.live) S.live = null; }
    const L = S.live;
    if (L) {
      if (L.arc && Date.now() - (Number(L.generated_ts) || 0) < BOX_STALE_MS) { S.arc = { at: L.generated_ts, usdc: Number(L.arc.usdc), method: "box" }; S.arcErr = null; }
      // live.json prices are only a fallback; fresher browser/Jupiter prices overwrite them later.
      S.prices = Object.assign({}, L.prices || {}, S.prices);
    }
    const best = boxWalletCandidates()[0];
    if (!best || Date.now() - best.ts > BOX_STALE_MS) { S.boxWallet = best || null; return false; }
    S.wallet = { at: best.ts, sol: best.sol, tokens: best.tokens.map((t) => ({ mint: t.mint, amount: Number(t.amount), program: t.program || null }))
      .filter((t) => t.amount > 0), tokensOk: true, tokenSrc: best.label + " " + (best.et || ""), warn: [], rpc: "box" };
    S.walletErr = null;
    S.prices = Object.assign({}, S.prices, best.prices);
    setSrc("Box wallet data", true, best.label + " " + (best.et || ""));
    return true;
  }

  async function loadWallets() {
    const hasLive = await loadLive();
    // Box positions.json cash_snapshot (dashboard_snapshot.py, Arc 8488 balanceOf; Liar's Dice Arc wallets excluded).
    const cs = S.snap && (S.snap.cash_snapshot || S.snap.cash);
    const csTs = cs ? (Number(cs.as_of_ts) || Number(S.snap.wallet_onchain && S.snap.wallet_onchain.generated_ts) || 0) : 0;
    if (cs && cs.arc_usdc != null && (!S.arc || S.arc.method !== "box" || csTs > (Number(S.arc.at) || 0)) && Date.now() - csTs < BOX_STALE_MS) {
      S.arc = { at: csTs, usdc: Number(cs.arc_usdc), method: "box" }; S.arcErr = null; setSrc("Arc USDC", true, "box positions.json cash_snapshot " + (cs.as_of_et || "")); }
    const arcFresh = !!S.arc && S.arc.method === "box";
    const jobs = [];
    if (!hasLive) jobs.push(C.getSolWallet().then((w) => {
      // Bordrless holdings (non-SPL, e.g. BSKT) are invisible to token-account reads: keep them from the box snapshot.
      const bw = S.boxWallet; const extra = bw ? bw.tokens.filter((t) => t.program === "bordrless" && Number(t.amount) > 0) : [];
      for (const t of extra) if (!w.tokens.some((x) => x.mint === t.mint)) w.tokens.push({ mint: t.mint, amount: Number(t.amount), program: "bordrless" });
      if (bw) S.prices = Object.assign({}, S.prices, bw.prices);
      S.wallet = Object.assign({ at: Date.now() }, w); S.walletErr = null;
      setSrc("Box wallet data", false, bw ? "stale (" + (bw.et || "?") + "), reading chain from browser" : "none");
      setSrc("Solana RPC (SOL balance)", !!w.rpc, w.rpc ? C.hostOf(w.rpc) : "all RPCs failed; SOL from Jupiter holdings");
      setSrc("Token holdings", w.tokensOk, w.tokensOk ? w.tokenSrc + " (" + w.tokens.length + " non-empty)" : "unavailable: " + w.warn.join("; ")); })
      .catch((e) => { S.walletErr = e.message; setSrc("Solana RPC (SOL balance)", false, e.message); setSrc("Token holdings", false, e.message); }));
    if (!arcFresh) jobs.push(C.getArcUsdc().then((a) => { S.arc = Object.assign({ at: Date.now() }, a); S.arcErr = null;
      setSrc("Arc RPC", true, C.hostOf(CFG.ARC_RPC) + " via " + a.method); })
      .catch((e) => { S.arcErr = e.message; setSrc("Arc RPC", false, e.message);
        if (cs && cs.arc_usdc != null) { S.arc = { at: csTs, usdc: Number(cs.arc_usdc), method: "box (stale)" }; } }));
    await Promise.all(jobs);

    const mints = new Set([CFG.SOL_MINT]);
    for (const t of (S.wallet && S.wallet.tokens) || []) if (t.amount > 0) mints.add(t.mint);
    for (const p of snapPositions()) if (p.mint) mints.add(p.mint);
    try { const bp = await C.getPrices([...mints]); S.prices = Object.assign({}, S.prices, bp); setSrc("Jupiter price", true, Object.keys(bp).length + " prices"); }
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
      const zeroVerified = p.onchain_amount === 0;
      const held = tokens ? tokens.find((t) => t.mint === p.mint && t.amount > 0) : null;
      if (held) { out.push({ mint: p.mint, amount: held.amount, value: px != null ? px * held.amount : null, snap: p, live: true, missing: false, zeroVerified: false }); continue; }
      out.push({ mint: p.mint, amount: (tokens || zeroVerified) ? 0 : p.tokens_ui, value: (tokens || zeroVerified) ? 0 : (px != null && p.tokens_ui ? px * p.tokens_ui : null),
                 snap: p, live: false, missing: !!tokens || zeroVerified, zeroVerified });
    }
    return out;
  }

  // ---------- render ----------
  function render() {
    const P = params();
    $("updated").textContent = C.nowEt();
    $("f-sol").innerHTML = `<a href="https://solscan.io/account/${CFG.SOL_WALLET}" target="_blank" rel="noopener">${short(CFG.SOL_WALLET)}</a>`;
    $("f-arc").textContent = short(CFG.ARC_WALLET);
    renderCards(P); const pos = renderPositions(P); renderPnl(pos); renderPerps(); renderDecision(P); renderScan(P, pos); renderRanges(); renderSources();
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
    if (S.arc) { $("c-arc").textContent = C.fmtUsd(S.arc.usdc); const cs2 = S.snap && (S.snap.cash_snapshot || S.snap.cash);
      $("c-arc-s").textContent = short(CFG.ARC_WALLET) + " · chain " + CFG.ARC_CHAIN_ID + (cs2 && cs2.total_cash_usd_approx != null ?
        " · SOL " + (cs2.sol_native != null ? Number(cs2.sol_native).toFixed(4) : "n/a") + " · total cash ≈ " + C.fmtUsd(cs2.total_cash_usd_approx) : ""); }
    else { $("c-arc").innerHTML = '<span class="neg">unavailable</span>'; $("c-arc-s").textContent = S.arcErr || "loading…"; }
    $("c-strat").textContent = `$${(P.mcapMin / 1e3).toFixed(0)}k–$${(P.mcapMax / 1e6).toFixed(1)}M · TP ${P.tp}× · max ${P.maxPos}`;
    $("c-strat-s").textContent = `$${P.buyUsd} buys from Sol cash · early full sell on first holder slowdown (prefer ~${P.early}×)` + (P.paused ? " · new buys paused until " + P.paused : "");
  }

  function spark(mint) {
    const sr = holderSeries(mint), a = sr.all; if (a.length < 2) return '<span class="muted">collecting…</span>';
    const t0 = Math.min(sr.start || a[0].t, a[0].t), t1 = Math.max(Date.now(), a[a.length - 1].t);
    const hs = a.map((x) => x.h), lo = Math.min(...hs), hi = Math.max(...hs), w = 110, h = 26;
    const X = (t) => ((t - t0) / Math.max(1, t1 - t0) * w).toFixed(1), Y = (v) => (h - 2 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 4)).toFixed(1);
    const pts = a.map((x) => X(x.t) + "," + Y(x.h)).join(" ");
    const col = hs[hs.length - 1] >= hs[0] ? "#3fb950" : "#f85149";
    const gap = a[0].t > t0 ? `<line x1="0" x2="${X(a[0].t)}" y1="${h - 1}" y2="${h - 1}" stroke="#8b949e" stroke-dasharray="2 2"/>` : "";
    return `<svg class="spark" width="${w}" height="${h}"><title>Holders over token lifetime: ${fmtSpan(t1 - t0)} (since ${dtfmt(t0)} ET)</title>${gap}<polyline fill="none" stroke="${col}" stroke-width="1.6" points="${pts}"/></svg>`;
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
    let html = '<div class="wrap"><table><thead><tr><th class="l">Token</th><th>Tokens held</th><th>Value (live)</th><th>Cost</th><th>PnL $</th><th>PnL %</th><th>Multiple</th><th class="l">Progress to TP</th><th>Holders</th><th>Δ5m</th><th>Δ1h</th><th class="l">Trend</th></tr></thead><tbody>';
    let totV = 0, totC = 0;
    for (const p of pos) {
      const info = S.info[p.mint]; if (info) pushHist(p.mint, info.holders, info.hc5);
      const sym = (info && info.symbol) || (p.snap && p.snap.symbol) || short(p.mint);
      const cost = p.snap && p.snap.cost_usd; const tp = (p.snap && p.snap._kind === "open") ? P.tp : (p.snap && p.snap.tp_multiple) || P.tp;
      const mult = cost && p.value != null ? p.value / cost : null;
      const pnl = cost && p.value != null ? p.value - cost : null;
      if (pnl != null && p.amount > 0) { totV += p.value; totC += cost; }
      let bar = '<span class="muted">cost unknown client-side</span>';
      if (mult != null) {
        const w = Math.max(0, Math.min(1, mult / tp)) * 100;
        bar = `<div class="bar" title="${mult.toFixed(2)}× of ${tp}× target"><i class="${mult < 1 ? "down" : ""}" style="width:${w.toFixed(1)}%"></i>` +
              `<b class="one" style="left:${(100 / tp).toFixed(1)}%" title="1.0× (cost)"></b><b style="left:${(100 * P.early / tp).toFixed(1)}%" title="${P.early}× early-exit preference"></b></div>` +
              `<div class="muted" style="font-size:11px">${p.snap._kind === "manual" ? "Exit" : "TP"} at ${C.fmtUsd(cost * tp)} (${Number(tp).toFixed(tp >= 10 ? 0 : 1)}×)${p.snap.entry_mc ? " · entry MC $" + C.fmtK(p.snap.entry_mc) + " → TP MC ≈ $" + C.fmtK(p.snap.entry_mc * tp) : ""}</div>`;
      }
      const tag = p.mint === CFG.FRANK ? ' <span class="badge HELD">FRANK, separate</span>' : (p.snap && p.snap._kind === "dust") ? ' <span class="badge SKIP">legacy dust</span>' : (p.snap && p.snap._kind === "manual") ? ' <span class="badge HELD">manual hold</span>' : "";
      const miss = p.zeroVerified ? `<div class="warn" style="font-size:11px">0 on-chain in ${short(CFG.SOL_WALLET)} (box check ${esc(p.snap.onchain_checked_et || "")}): sold / no longer held; position file still lists it as open</div>` : p.missing ? '<div class="warn" style="font-size:11px">In snapshot as open but not in wallet now (likely sold since snapshot)</div>' : (!p.live ? '<div class="muted" style="font-size:11px">value from snapshot token amount × live price</div>' : "");
      const li = (S.live && S.live.info && S.live.info[p.mint]) || null;
      const curMc = li && li.mc ? Number(li.mc) : null, emc = p.snap && p.snap.entry_mc;
      const mcLine = (p.snap && p.snap._kind === "manual" && (emc || curMc)) ? `<div class="muted" style="font-size:11px">avg entry MC $${emc ? C.fmtK(emc) : "-"} → now $${curMc ? C.fmtK(curMc) : "-"}</div>` : "";
      const buyLink = mcLine + ((p.snap && p.snap.buy_sig) ? `<div class="muted" style="font-size:11px"><a href="https://solscan.io/tx/${esc(p.snap.buy_sig)}" target="_blank" rel="noopener">buy tx</a>${p.snap.cost_sol ? " · " + Number(p.snap.cost_sol).toFixed(4) + " SOL" : ""}</div>` : "");
      html += `<tr><td class="l"><a href="${dex(p.mint)}" target="_blank" rel="noopener">${esc(sym)}</a> ${(p.mint === "4iWwcHf9tH6J6UjRgG9rXosXVxNdcKUFuqh1rbps6H7J" || p.mint === "mN8pEpVV4z7kvRS8QFWAmxKdAoKbLXPkdMHVuQgxFr5") ? `<a href="https://bordrless.app/token/${encodeURIComponent(p.mint)}" target="_blank" rel="noopener" style="font-size:11px">Bordrless</a>` : `<a href="https://pump.fun/coin/${encodeURIComponent(p.mint)}" target="_blank" rel="noopener" style="font-size:11px">pump.fun</a>`}${tag}${miss}${buyLink}</td>` +
        `<td>${p.amount != null ? Number(p.amount).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "-"}</td><td>${C.fmtUsd(p.value)}<div class="muted" style="font-size:11px" title="${esc(S.pxSrc[p.mint] || "")}">${S.prices[p.mint] != null ? "@ $" + Number(S.prices[p.mint]).toPrecision(4) + (S.pxSrc[p.mint] ? " · " + esc(S.pxSrc[p.mint].split(" x ")[0]) : "") : ""}</div></td><td>${cost ? C.fmtUsd(cost) : "-"}</td>` +
        `<td class="${pnl == null ? "muted" : cls(pnl)}">${sgnUsd(pnl)}</td><td class="${pnl == null ? "muted" : cls(pnl)}">${pnl == null ? "-" : sgnPct(pnl / cost * 100)}</td>` +
        `<td class="${mult == null ? "muted" : mult >= 1 ? "pos" : "neg"}">${mult == null ? "-" : mult.toFixed(2) + "×"}</td>` +
        `<td class="l">${bar}</td><td>${info ? info.holders.toLocaleString() : "-"}</td>` +
        `<td class="${cls(info && info.hc5)}">${info ? C.fmtPct(info.hc5) : "-"}</td><td class="${cls(info && info.hc1)}">${info ? C.fmtPct(info.hc1) : "-"}</td>` +
        `<td class="l"><a href="#" class="spark-link" data-mint="${esc(p.mint)}" title="Click for holder details">${spark(p.mint)}</a><div style="font-size:11px">${holderSignal(p.mint, info)}</div></td></tr>`;
    }
    if (totC) html += `<tr class="bk-sum"><td class="l" colspan="2">Total open</td><td>${C.fmtUsd(totV)}</td><td>${C.fmtUsd(totC)}</td><td class="${cls(totV - totC)}">${sgnUsd(totV - totC)}</td><td class="${cls(totV - totC)}">${sgnPct((totV / totC - 1) * 100)}</td><td colspan="6"></td></tr>`;
    html += "</tbody></table></div>";
    if (S.walletErr) html += `<div class="msg err">Live wallet read failed (${esc(S.walletErr)}). Rows above come from the snapshot.</div>`;
    $("positions").innerHTML = html; saveHist();
    return pos;
  }


  // ---------- Perp longs (virtualtrade.app) ----------
  const fmtPx = (v) => (v == null ? "-" : "$" + Number(v).toPrecision(4));
  function perpCalc(p, px) {
    const m = Number(p.margin_usd), n = Number(p.notional_usd), e = Number(p.entry_price_usd), l = Number(p.liq_price_usd);
    if (!(px > 0 && m > 0 && n > 0 && e > 0)) return null;
    const short = String(p.side || "long").toLowerCase() === "short";
    const raw = m + n * (short ? e / px - 1 : px / e - 1);
    const liquidated = l > 0 && (short ? px >= l : px <= l);
    const eq = liquidated || raw < 0 ? 0 : raw;
    const dist = l > 0 ? (short ? (l - px) / px : (px - l) / px) * 100 : null;
    return { px, eq, pnl: eq - m, pct: (eq - m) / m * 100, dist, liquidated };
  }
  function renderPerps() {
    const sec = $("perp-sec"), el = $("perps"); if (!sec || !el) return;
    const list = perpList();
    if (!list.length) { sec.hidden = true; return; }
    sec.hidden = false;
    let tm = 0, te = 0, tn = 0, nPriced = 0, anyLive = false;
    let h = '<div class="wrap"><table><thead><tr><th class="l">Position</th><th>Live price</th><th>Equity (value)</th><th>PnL $</th><th>PnL % of margin</th><th>Dist. to liq</th><th>Entry</th><th>Liq price</th><th>Lev</th><th>Margin</th><th>Notional</th></tr></thead><tbody>';
    for (const p of list) {
      const live = S.prices[p.underlying_mint]; const sn = p.calc;
      const px = live != null ? live : (sn && sn.price_usd) || null; const isLive = live != null; if (isLive) anyLive = true;
      const c = perpCalc(p, px);
      const m = Number(p.margin_usd) || 0; tm += m; tn += Number(p.notional_usd) || 0;
      if (c) { te += c.eq; nPriced++; } else te += m;
      const side = String(p.side || "long").toLowerCase();
      h += `<tr><td class="l">${p.open_sig ? `<a href="https://solscan.io/tx/${esc(p.open_sig)}" target="_blank" rel="noopener">${esc(p.symbol || "perp #" + p.id)}</a>` : esc(p.symbol || "perp #" + p.id)} <span class="badge HELD">${esc(p.leverage)}× ${esc(side)}</span>` +
        `<div class="muted" style="font-size:11px">#${esc(p.id)} · ${esc(p.market || "")} · opened ${esc(p.opened_et || "-")}${c && c.liquidated ? ' · <span class="neg">LIQUIDATED (price ≤ liq)</span>' : ""}</div></td>` +
        `<td>${fmtPx(px)}<div class="muted" style="font-size:11px">${isLive ? esc(((S.pxSrc[p.underlying_mint] || "live").split(" x ")[0])) + " · live" : "snapshot price"}</div></td>` +
        `<td>${c ? C.fmtUsd(c.eq) : "-"}</td>` +
        `<td class="${c ? cls(c.pnl) : "muted"}">${c ? sgnUsd(c.pnl) : "-"}</td><td class="${c ? cls(c.pnl) : "muted"}">${c ? sgnPct(c.pct) : "-"}</td>` +
        `<td class="${c && c.dist != null ? (c.dist < 5 ? "neg" : c.dist < 10 ? "warn" : "pos") : "muted"}">${c && c.dist != null ? c.dist.toFixed(2) + "% below" : "-"}</td>` +
        `<td>${fmtPx(p.entry_price_usd)}</td><td>${fmtPx(p.liq_price_usd)}</td><td>${esc(p.leverage)}×</td><td>${C.fmtUsd(m)}</td><td>${C.fmtUsd(p.notional_usd)}</td></tr>`;
    }
    if (list.length > 0 && nPriced) h += `<tr class="bk-sum"><td class="l">Combined (${list.length} positions)</td><td></td><td>${C.fmtUsd(te)}</td><td class="${cls(te - tm)}">${sgnUsd(te - tm)}</td><td class="${cls(te - tm)}">${sgnPct((te / tm - 1) * 100)}</td><td colspan="4"></td><td>${C.fmtUsd(tm)}</td><td>${C.fmtUsd(tn)}</td></tr>`;
    h += "</tbody></table></div>" +
      `<div class="muted" style="font-size:11px;margin-top:6px">equity = margin + notional × (price ÷ entry − 1), floored at 0 (liquidated if price ≤ liq). Gross of the program's ~0.2% open/close fee on margin. Price = ${esc("VIRTUAL")} from Jupiter/DexScreener; the program settles on its own feed, which can differ slightly. Positions are on-chain perps on virtualtrade.app, not token holdings.</div>`;
    el.innerHTML = h;
    $("perp-note").innerHTML = anyLive ? '<span class="pos">● live</span>' : '<span class="warn">snapshot prices</span>';
    const t = $("perp-total"); if (t && nPriced) t.innerHTML = `combined PnL <span class="${cls(te - tm)}">${sgnUsd(te - tm)} (${sgnPct((te / tm - 1) * 100)})</span> on ${C.fmtUsd(tm)} margin`;
  }

  // ---------- holder detail panel (click the trend line) ----------
  let openMint = null, hpRange = "all";
  const tfmt = (t) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
  const dtfmt = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const hmfmt = (t) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  function fmtSpan(ms) { const m = ms / 60000; return m < 90 ? Math.round(m) + " min" : m < 48 * 60 ? (m / 60).toFixed(1) + " h" : (m / 1440).toFixed(1) + " days"; }
  const RANGES = { "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3, all: null };
  function newHoldersBetween(a, fromT, toT) {
    const pts = a.filter((x) => x.t >= fromT && x.t <= toT); if (pts.length < 2) return null;
    return pts[pts.length - 1].h - pts[0].h;
  }
  function bigChart(sr, range) {
    const now = Date.now(), span = RANGES[range];
    const lifeStart = Math.min(sr.start || now, sr.all.length ? sr.all[0].t : now);
    const t0 = span ? Math.max(now - span, range === "all" ? 0 : lifeStart) : lifeStart, t1 = now;
    const inR = (x) => x.t >= t0 && x.t <= t1;
    // include the last point before the window so the line enters from the left edge
    const prevOf = (arr) => { let p = null; for (const x of arr) if (x.t < t0) p = x; return p; };
    const all = sr.all.filter(inR), m = sr.m.filter(inR), d = sr.d.filter(inR);
    const pa = prevOf(sr.all); if (pa) all.unshift(pa);
    if (all.length < 1) return '<div class="muted">No holder samples in this range yet.</div>';
    const W = 640, H = 210, L = 52, R = 12, T = 10, B = 30;
    const hs = all.map((x) => x.h), lo = Math.min(...hs), hi = Math.max(...hs);
    const X = (t) => L + (Math.max(t0, Math.min(t1, t)) - t0) / Math.max(1, t1 - t0) * (W - L - R);
    const Y = (h) => T + (hi === lo ? 0.5 : 1 - (h - lo) / (hi - lo)) * (H - T - B);
    const col = hs[hs.length - 1] >= hs[0] ? "#3fb950" : "#f85149";
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#30363d" stroke-dasharray="3 3"/><text x="${L - 6}" y="${(y + 4).toFixed(1)}" fill="#8b949e" font-size="11" text-anchor="end">${Math.round(v).toLocaleString()}</text>`; }
    const long = t1 - t0 > 20 * 3600e3;
    for (let i = 0; i <= 4; i++) { const t = t0 + (t1 - t0) * i / 4, x = X(t);
      g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#21262d"/>` +
        `<text x="${x.toFixed(1)}" y="${H - 12}" fill="#8b949e" font-size="11" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${long ? dtfmt(t) : hmfmt(t)}</text>`; }
    g += `<text x="${W - R}" y="${H - 1}" fill="#8b949e" font-size="10" text-anchor="end">ET</text>`;
    const firstT = all[0].t;
    if (firstT > t0 + (t1 - t0) * 0.01) g += `<rect x="${L}" y="${T}" width="${(X(firstT) - L).toFixed(1)}" height="${H - T - B}" fill="#8b949e14"/><text x="${((L + X(firstT)) / 2).toFixed(1)}" y="${(T + 16)}" fill="#8b949e" font-size="10" text-anchor="middle">no holder data</text>`;
    if (sr.created && sr.created >= t0) g += `<line x1="${X(sr.created).toFixed(1)}" x2="${X(sr.created).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#d29922" stroke-dasharray="4 3"/><text x="${(X(sr.created) + 3).toFixed(1)}" y="${H - B - 4}" fill="#d29922" font-size="10">launch</text>`;
    const line = (arr, extra) => arr.length > 1 ? `<polyline fill="none" stroke="${col}" ${extra} points="${arr.map((x) => X(x.t).toFixed(1) + "," + Y(x.h).toFixed(1)).join(" ")}"/>` : "";
    const tip = (x, d) => `<title>${dtfmt(x.t)} ET: ${x.h.toLocaleString()} holders${d != null ? " (" + (d >= 0 ? "+" : "") + d + ")" : ""}${x.src === "derived" ? " (derived from Jupiter % change)" : ""}</title>`;
    const showDots = m.length <= 150;
    const dots = (showDots ? m.map((x, i) => `<circle cx="${X(x.t).toFixed(1)}" cy="${Y(x.h).toFixed(1)}" r="2.5" fill="${col}">${tip(x, i ? x.h - m[i - 1].h : null)}</circle>`).join("") : "") +
      d.map((x) => `<circle cx="${X(x.t).toFixed(1)}" cy="${Y(x.h).toFixed(1)}" r="3.5" fill="#0d1117" stroke="${col}" stroke-width="1.5">${tip(x)}</circle>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto">${g}${line(all, 'stroke-width="1.4" stroke-dasharray="4 3" opacity="0.7"')}${line(m, 'stroke-width="2"')}${dots}</svg>`;
  }
  function renderHolderPanel() {
    if (!openMint) return;
    const m = openMint, info = S.info[m], sr = holderSeries(m), a = sr.m;
    const sym = (info && info.symbol) || short(m), now = Date.now();
    const last5 = newHoldersBetween(a, now - 5 * 60000, now), prev5 = newHoldersBetween(a, now - 10 * 60000, now - 5 * 60000);
    let pace = '<span class="muted">Needs about 10 minutes of history on this page.</span>';
    if (last5 != null && prev5 != null) {
      const slow = (prev5 >= 4 && last5 < prev5 * 0.5) || last5 <= 0;
      pace = `<b>${last5 >= 0 ? "+" : ""}${last5}</b> new holders in the last 5 min vs <b>${prev5 >= 0 ? "+" : ""}${prev5}</b> in the 5 min before. ` +
        (slow ? '<span class="warn">Pace is slowing.</span>' : '<span class="pos">Pace is holding up.</span>');
    } else if (last5 != null) pace = `<b>${last5 >= 0 ? "+" : ""}${last5}</b> new holders in the last 5 min (not enough history yet for the prior 5 min).`;
    const first = sr.all[0], cur = a[a.length - 1] || sr.all[sr.all.length - 1];
    const sess = first && cur ? `${(cur.h - first.h >= 0 ? "+" : "")}${(cur.h - first.h).toLocaleString()} since ${dtfmt(first.t)} ET` : "-";
    const stat = (k, v, c) => `<div class="hstat"><div class="muted">${k}</div><div class="${c || ""}">${v}</div></div>`;
    let h = `<div class="hp-head"><h2 style="margin:0">${esc(sym)} holders</h2><button id="hp-close" title="Close">✕</button></div>`;
    h += '<div class="hstats">' +
      stat("Holders now", info ? info.holders.toLocaleString() : (cur ? cur.h.toLocaleString() : "-")) +
      stat("Change over recorded history", sess) +
      stat("Token age", sr.created ? fmtSpan(now - sr.created) + " (launched " + dtfmt(sr.created) + " ET)" : "-") +
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
    h += '<div class="hp-ranges" style="margin:6px 0">' + Object.keys(RANGES).map((k) =>
      `<button data-range="${k}" class="${k === hpRange ? "on" : ""}">${k === "all" ? "All" : k}</button>`).join("") + "</div>";
    h += bigChart(sr, hpRange);
    const firstM = a[0];
    h += `<div class="muted" style="font-size:11px">Solid line/dots = measured holder counts${firstM ? " (since " + dtfmt(firstM.t) + " ET)" : ""}. Hollow dots + dashed line = derived from Jupiter's 5m/1h/6h/24h holder % change. Shaded = no data (no free source has a holder-count history before that).</div>`;
    const rows = a.slice(-15).reverse();
    if (rows.length) {
      h += '<table style="margin-top:10px"><thead><tr><th class="l">Time (ET)</th><th>Holders</th><th>Change</th><th>Jupiter Δ5m</th></tr></thead><tbody>';
      rows.forEach((x, i) => { const p = a[a.length - 1 - i - 1]; const d = p ? x.h - p.h : null;
        h += `<tr><td class="l">${tfmt(x.t)}</td><td>${x.h.toLocaleString()}</td><td class="${cls(d)}">${d == null ? "-" : (d >= 0 ? "+" : "") + d}</td><td class="${cls(x.hc5)}">${x.hc5 == null ? "-" : C.fmtPct(x.hc5)}</td></tr>`; });
      h += "</tbody></table>";
    }
    h += `<div style="margin-top:10px;font-size:13px"><a href="https://solscan.io/token/${encodeURIComponent(m)}#holders" target="_blank" rel="noopener">Full holder list on Solscan</a> · <a href="${dex(m)}" target="_blank" rel="noopener">Chart</a></div>`;
    h += '<div class="muted" style="margin-top:6px;font-size:11px">History is recorded on the bot box about once a minute for the whole life of each position (older points thinned) and merged with samples this browser takes while the page is open.</div>';
    $("holder-panel-body").innerHTML = h;
    $("hp-close").onclick = closeHolder;
    for (const b of document.querySelectorAll(".hp-ranges button")) b.onclick = () => { hpRange = b.dataset.range; renderHolderPanel(); };
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
    if (s.cash_snapshot && s.cash_snapshot.as_of_et) h += `<div class="muted">Cash (${esc(s.cash_snapshot.as_of_et)}): ${esc(s.cash_snapshot.note || "")}</div>`;
    h += "</div>";
    $("decision").innerHTML = h;
  }

  // ---------- Open PnL (2026-10-21 owner: real-time PnL on open positions only, no history) ----------
  const sgnUsd = (v) => (v == null ? "-" : (v >= 0 ? "+" : "-") + C.fmtUsd(Math.abs(v)));
  const sgnPct = (v) => (v == null ? "-" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");
  function renderPnl(pos) {
    let uv = 0, uc = 0, n = 0; const parts = [];
    for (const p of pos || []) {
      const c = p.snap && p.snap.cost_usd; if (!c || p.value == null || !(p.amount > 0)) continue;
      uv += p.value; uc += c; n++; parts.push(esc((p.snap.symbol || short(p.mint))) + " " + sgnUsd(p.value - c));
    }
    if (n) { $("c-upnl").innerHTML = `<span class="${cls(uv - uc)}">${sgnUsd(uv - uc)}</span> <small class="${cls(uv - uc)}" style="font-size:14px">${sgnPct((uv / uc - 1) * 100)}</small>`;
             $("c-upnl-s").innerHTML = `${n} open · value ${C.fmtUsd(uv)} vs cost ${C.fmtUsd(uc)} · ${parts.join(", ")}`; }
    else { $("c-upnl").textContent = "$0.00"; $("c-upnl-s").textContent = "no open positions with a cost basis"; }
  }

  // Live prices for open positions only, every LIVE_PX_MS: Jupiter -> DexScreener -> Bordrless curve (on-chain pool read).
  function openMints() {
    const m = new Set();
    for (const p of snapPositions()) if (p.mint && (p._kind === "open" || p._kind === "manual" || p._kind === "dust")) m.add(p.mint);
    for (const p of perpList()) if (p.underlying_mint) m.add(p.underlying_mint);
    for (const t of (S.wallet && S.wallet.tokens) || []) if (t.amount > 0 && t.mint !== CFG.SOL_MINT && !CFG.STABLES.includes(t.mint) && S.prices[t.mint] != null && S.prices[t.mint] * t.amount >= MIN_POS_USD) m.add(t.mint);
    return [...m];
  }
  async function bordrlessPx(pool, solPx) {
    const r = await C.solRpc("getAccountInfo", [pool, { encoding: "base64", commitment: "confirmed" }]);
    const v = r.result && r.result.value; if (!v) throw new Error("pool not found");
    const raw = atob(v.data[0]), dv = new DataView(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) dv.setUint8(i, raw.charCodeAt(i));
    const u = (o) => Number(dv.getBigUint64(o, true));
    const bR = u(210), qR = u(218), vB = u(226), vQ = u(234);
    if (!(vB + bR > 0)) throw new Error("bad pool data");
    return (vQ + qR) / (vB + bR) * 1e-3 * solPx; // lamports per raw unit -> SOL per token (6 dp) -> USD
  }
  async function livePrices() {
    if (S.pxBusy) return; S.pxBusy = true;
    try {
      const mints = openMints(); if (!mints.length) { S.pxAt = Date.now(); S.pxErr = null; return; }
      const got = {}, src = {}, errs = [];
      try { const jp = await C.getPrices([CFG.SOL_MINT, ...mints]); for (const [k, v] of Object.entries(jp)) { got[k] = v; src[k] = "Jupiter"; } }
      catch (e) { errs.push("Jupiter: " + e.message); }
      const solPx = got[CFG.SOL_MINT] || S.prices[CFG.SOL_MINT];
      const needDex = mints.filter((m) => got[m] == null && !BORDRLESS_POOLS[m]);
      if (needDex.length) {
        try {
          const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + needDex.slice(0, 30).join(",")); const j = await r.json();
          for (const m of needDex) {
            const ps = (j.pairs || []).filter((p) => p.baseToken && p.baseToken.address === m && Number(p.priceUsd) > 0 && p.dexId !== "pumpfun")
              .sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
            if (ps[0]) { got[m] = Number(ps[0].priceUsd); src[m] = "DexScreener"; }
          }
        } catch (e) { errs.push("DexScreener: " + e.message); }
      }
      for (const m of mints) {
        if (got[m] != null || !BORDRLESS_POOLS[m]) continue;
        try { if (!solPx) throw new Error("no SOL price"); got[m] = await bordrlessPx(BORDRLESS_POOLS[m], solPx); src[m] = "Bordrless curve (on-chain) x SOL " + C.fmtUsd(solPx); }
        catch (e) { errs.push("Bordrless " + short(m) + ": " + e.message); }
      }
      S.prices = Object.assign({}, S.prices, got); Object.assign(S.pxSrc, src);
      const missing = mints.filter((m) => got[m] == null);
      S.pxErr = missing.length ? "no live price for " + missing.map(short).join(", ") + (errs.length ? " (" + errs.join("; ") + ")" : "") : null;
      if (mints.some((m) => got[m] != null)) S.pxAt = Date.now();
      const pos = renderPositions(params()); renderPnl(pos); renderPerps();
    } finally { S.pxBusy = false; }
  }
  function renderLiveAge() {
    const el = $("live-age"); if (!el) return;
    const s = S.pxAt ? Math.round((Date.now() - S.pxAt) / 1000) : null;
    el.innerHTML = (s == null ? "live prices loading…" : `<span class="${s > 20 ? "warn" : "pos"}">● live PnL, updated ${s}s ago</span> · every ${LIVE_PX_MS / 1000}s`) +
      (S.pxErr ? ` · <span class="warn">${esc(S.pxErr)}</span>` : "");
  }

  function evalCtx(pos) {
    const s = S.snap || {};
    return { excludeMints: [...new Set([...(s.exclude_mints || []), ...CFG.EXCLUDE_MINTS])],
             excludeSymbols: [...new Set([...(s.exclude_symbols || []), ...CFG.EXCLUDE_SYMBOLS])],
             heldMints: (pos || []).filter((p) => p.live).map((p) => p.mint) };
  }

  // ---------- scanner "first seen" (display only) ----------
  // Server: positions.json scanner_first_seen (bot scan lists, written by dashboard_snapshot.py).
  // Page: tokens this browser sees appear between bot scans (localStorage). Gone > 6h and back = new again.
  const FS_RENEW = 6 * 3600e3;
  let scanSort = localStorage.getItem("scanSort") || "newest", fsLocal = (() => { try { return JSON.parse(localStorage.getItem("scanFirstSeen") || "{}"); } catch (e) { return {}; } })();
  let lastScanAt = null, prevScanIds = null, scanRounds = 0;
  function updateLocalFs(ids) {
    const now = Date.now(), base = scanRounds === 0 && !Object.keys(fsLocal).length;
    for (const id of ids) { const e = fsLocal[id];
      if (!e || now - e.last > FS_RENEW) fsLocal[id] = { t: now, last: now, baseline: base || scanRounds === 0 };
      else e.last = now; }
    for (const [id, e] of Object.entries(fsLocal)) if (now - e.last > 7 * 86400e3) delete fsLocal[id];
    try { localStorage.setItem("scanFirstSeen", JSON.stringify(fsLocal)); } catch (e) {}
  }
  function firstSeen(id) {
    const sv = S.snap && S.snap.scanner_first_seen && S.snap.scanner_first_seen.tokens && S.snap.scanner_first_seen.tokens[id];
    const lc = fsLocal[id];
    const svT = sv ? sv.first_seen * 1000 : null;
    // server renewed after a >6h gap or page-spotted earlier than the bot's scan -> use the newer evidence sensibly
    if (sv && lc && !lc.baseline && lc.t < svT && svT - lc.t < FS_RENEW) return { t: lc.t, baseline: false, src: "page" };
    if (sv) return { t: svT, baseline: !!sv.baseline, src: "bot scan" };
    if (lc) return { t: lc.t, baseline: !!lc.baseline, src: "page" };
    return { t: null, baseline: true, src: null };
  }
  function agoTxt(ms) { const m = Math.floor(ms / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h " + (m % 60) + "m ago" : Math.floor(m / 1440) + "d ago"; }
  const hm = (t) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  function fsCell(f) {
    if (!f.t) return '<td class="l fs muted">-</td>';
    if (f.baseline) {
      const since = S.snap && S.snap.scanner_first_seen && S.snap.scanner_first_seen.tracking_since;
      const lbl = f.src === "page" ? `listed when page opened (${hm(f.t)})` : `on scanner before tracking began (${hm(f.t)})`;
      return `<td class="l fs"><span class="muted" title="Already on the scanner when first-seen tracking started${since ? " (" + esc(since) + ")" : ""}">${lbl}</span></td>`;
    }
    const age = Date.now() - f.t;
    const badge = age < 15 * 60e3 ? '<span class="badge NEW">NEW</span> ' : age < 60 * 60e3 ? '<span class="badge new">new</span> ' : "";
    return `<td class="l fs" title="First seen ${esc(new Date(f.t).toLocaleString("en-US", { timeZone: "America/New_York" }))} ET (via ${f.src})">${badge}first seen ${agoTxt(age)}<div class="muted">${hm(f.t)} ET</div></td>`;
  }
  function renderSortBar() {
    const el = $("scan-sort"); if (!el) return;
    el.innerHTML = '<span class="muted">Sort:</span>' + [["newest", "Newest first"], ["verdict", "Verdict, then score (old sort)"]].map(([k, l]) => `<button data-sort="${k}" class="${scanSort === k ? "on" : ""}">${l}</button>`).join("") +
      ' <span class="muted" style="margin-left:8px"><span class="badge NEW">NEW</span> first seen &lt; 15 min · <span class="badge new">new</span> &lt; 60 min</span>';
    for (const b of el.querySelectorAll("button")) b.onclick = () => { scanSort = b.dataset.sort; localStorage.setItem("scanSort", scanSort); render(); };
  }

  function renderScan(P, pos) {
    const tb = document.querySelector("#scan tbody");
    renderSortBar();
    if (!S.scan) { tb.innerHTML = `<tr><td class="l" colspan="17"><div class="msg err">Scan unavailable: ${esc(S.scanErr || "loading…")}. Jupiter token API blocked or unreachable from this browser.</div></td></tr>`; return; }
    const ctx = evalCtx(pos);
    const inBand0 = S.scan.cands.filter((c) => c.mcap >= P.mcapMin && c.mcap <= P.mcapMax);
    ensureQuotes(inBand0.map((c) => c.id)).then((got) => { if (got) render(); });
    const inBand = inBand0.filter((c) => !notSol(c.id));
    const newRound = S.scan.at !== lastScanAt;
    if (newRound) { updateLocalFs(inBand.map((c) => c.id)); }
    const rows = inBand.map((c) => ({ c, e: C.evaluate(c, ctx), f: firstSeen(c.id) }));
    const rank = { PASS: 0, HELD: 1, SKIP: 2 };
    const oldSort = (a, b) => rank[a.e.verdict] - rank[b.e.verdict] || b.c.score - a.c.score;
    const fsKey = (r) => r.f.t == null ? -Infinity : r.f.baseline ? r.f.t - 1e13 : r.f.t; // baseline (pre-tracking) rows sink below tracked ones
    rows.sort(scanSort === "newest" ? ((a, b) => fsKey(b) - fsKey(a) || oldSort(a, b)) : oldSort);
    const flashIds = new Set(newRound && prevScanIds ? inBand.map((c) => c.id).filter((id) => !prevScanIds.has(id)) : []);
    if (newRound) { prevScanIds = new Set(inBand.map((c) => c.id)); lastScanAt = S.scan.at; scanRounds++; }
    const nPass = rows.filter((r) => r.e.verdict === "PASS").length;
    $("scan-note").textContent = `${rows.length} candidates in band · ${nPass} PASS · universe ${S.scan.cands.length} tokens · scanned ${C.nowEt(new Date(S.scan.at))}`;
    const organicOpen = (pos || []).filter((p) => p.live && !(p.snap && p.snap._kind === "dust") && p.mint !== CFG.FRANK).length;
    const best = rows.find((r) => r.e.verdict === "PASS");
    $("top-pass").innerHTML = best
      ? `<div class="msg ok">Top PASS right now: <b>${esc(best.c.symbol)}</b> ($${C.fmtK(best.c.mcap)} MC). ${organicOpen >= P.maxPos ? "Max positions reached, so the bot would not add." : "Information only. The bot makes its own decision on its next scan."}</div>`
      : `<div class="msg">Nothing passes all rules right now, so the bot would skip.</div>`;
    if (!rows.length) { tb.innerHTML = '<tr><td class="l muted" colspan="17">No tokens in the band in the current Jupiter lists.</td></tr>'; return; }
    tb.innerHTML = rows.map(({ c, e, f }) => {
      const top = c.topHolders == null ? "-" : c.topHolders.toFixed(0) + "%";
      const age = f.t && !f.baseline ? Date.now() - f.t : Infinity;
      const rc = [age < 15 * 60e3 ? "new15" : age < 60 * 60e3 ? "new60" : "", flashIds.has(c.id) ? "flash" : ""].join(" ").trim();
      return `<tr class="${rc}" data-id="${esc(c.id)}">${fsCell(f)}<td class="l"><span class="badge ${e.verdict}">${e.verdict}</span></td>` +
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
    if (S.live) { $("banner").innerHTML = ""; return; }
    $("banner").innerHTML = blocked.length ? `<div class="msg warn">Some live sources failed from this browser: ${blocked.map(([k, v]) => esc(k) + " (" + esc(v.detail) + ")").join("; ")}. ` +
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
    if (!S.busy && Date.now() >= Math.min(S.nextScan, S.nextWallet, S.nextSnap)) tick(false);
    renderLiveAge();
  }, 1000);
  setInterval(() => { if (S.snap || S.wallet) livePrices().catch((e) => { S.pxErr = e.message; }); }, LIVE_PX_MS);
  $("refresh").addEventListener("click", () => tick(true));
  tick(true);
})();
