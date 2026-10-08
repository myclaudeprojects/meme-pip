/* Organic loop dashboard - data core (READ-ONLY).
 * Only public, unauthenticated GET / JSON-RPC *read* calls. No signing, no keys,
 * no transaction building, no order endpoints. Works in browsers and in Node 18+.
 */
(function (root) {
  "use strict";

  const CONFIG = {
    SOL_WALLET: "9UpbfLG7qJAjEQK44FzY1ZtAS22jpb97fW9mYwZAgRgk",
    ARC_WALLET: "0x341BB8851Ff8fD9EAE20ea083c2F779e646B8488",
    JUP_HOSTS: ["https://lite-api.jup.ag/tokens/v2", "https://api.jup.ag/tokens/v2"],
    JUP_PRICE: "https://lite-api.jup.ag/price/v3",
    LISTS: ["toporganicscore/5m", "toporganicscore/1h", "toporganicscore/6h",
            "toptrending/1h", "toptraded/1h", "toporganicscore/24h"],
    // Read-only wallet holdings (SOL + every SPL / Token-2022 account). Public GET, CORS-enabled.
    JUP_HOLDINGS: "https://lite-api.jup.ag/ultra/v1/holdings/",
    // Public Solana RPCs, tried in order. text/plain = "simple" CORS request (no preflight);
    // leorpc's preflight omits Allow-Headers, so application/json would be blocked there.
    // api.mainnet-beta requires application/json and may 403 browser Origins (kept as last resort).
    SOL_RPCS: [{ url: "https://solana-rpc.publicnode.com", ct: "text/plain" },
               { url: "https://solana.leorpc.com/?api_key=FREE", ct: "text/plain" },
               { url: "https://api.mainnet-beta.solana.com", ct: "application/json" }],
    // Arc RPC + chain taken from the loop's bridge scripts (chainId 5042 = 0x13b2).
    ARC_RPC: "https://warp-arc-production.up.railway.app/rpc",
    ARC_CHAIN_ID: 5042,
    // USDC on Arc: native gas token; ERC-20 interface at 0x3600..0000 (6 decimals).
    ARC_USDC: "0x3600000000000000000000000000000000000000",
    TOKEN_PROGRAMS: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                     "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"],
    SOL_MINT: "So11111111111111111111111111111111111111112",
    STABLES: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC
              "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"], // USDT
    SI276: "HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump",
    FRANK: "HbPDWSqu8hpVMX6gMjwMDGe5rVgicWo3Qh3Jaojypump",
    // Defaults; overridden by positions.json (state.json) when present.
    MCAP_MIN: 200000, MCAP_MAX: 1000000, MAX_POSITIONS: 2, BUY_USD: 500, TP_MULT: 1.4, EARLY_MULT: 1.2,
    EXCLUDE_MINTS: ["75gGuxuqKhQQiHae8JKDQaetK3XguKf1rUJ1csispump",
                    "HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump",
                    "HbPDWSqu8hpVMX6gMjwMDGe5rVgicWo3Qh3Jaojypump"],
    EXCLUDE_SYMBOLS: ["SI276", "FRANK", "TWEETCRAFT", "ATTENTION", "ATTENTION+"],
    POSITION_MIN_USD: 5,
  };

  // Judgment thresholds layered on top of scan_organic.py's hard filters.
  const RULES = {
    minOrgBuyPct: 10,     // organic buy $ / 1h buy $ below this = bot-driven volume
    maxPc1: 100,          // 1h price change above this % = pump chase
    maxTopHolders: 40,    // top-holder concentration %
    minPoolAgeMin: 60,    // pools younger than this = brand-new
    minHc5Flat: 0.1,      // 0 < hc5 < this % = holders ~flat / slowing
    minNob1: 10,          // fewer organic buyers in 1h = thin organic demand
    maxPrice: 1.0,        // unit price cap (unless pump launchpad), as in scan_organic.py
  };

  const num = (x, d = 0) => { const v = Number(x); return Number.isFinite(v) ? v : d; };

  async function fetchJson(url, opts = {}, timeoutMs = 15000) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await fetch(url, Object.assign({ headers: { Accept: "application/json" } }, opts, ctl ? { signal: ctl.signal } : {}));
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      throw new Error(explainFetchError(e));
    } finally { if (t) clearTimeout(t); }
  }

  function explainFetchError(e) {
    const m = String((e && e.message) || e);
    if (e && e.name === "AbortError") return "timed out";
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m))
      return "blocked or unreachable (CORS / network / ad-blocker)";
    return m;
  }

  // ---------- Jupiter scan ----------
  async function fetchList(path) {
    let last = "no data";
    for (const host of CONFIG.JUP_HOSTS) {
      try {
        const d = await fetchJson(host + "/" + path);
        if (Array.isArray(d) && d.length) return { rows: d, host, path, ok: true };
        last = "empty";
      } catch (e) { last = e.message; }
    }
    return { rows: [], host: null, path, ok: false, err: last };
  }

  function rowToCand(row, src) {
    const id = row.id || row.address;
    if (!id || typeof id !== "string") return null;
    if (id === CONFIG.SOL_MINT || CONFIG.STABLES.includes(id)) return null;
    const s5 = row.stats5m || {}, s1 = row.stats1h || {}, s6 = row.stats6h || {}, s24 = row.stats24h || {};
    const org = num(row.organicScore);
    const buyOrg = num(s1.buyOrganicVolume), buyVol = num(s1.buyVolume);
    const hc1 = num(s1.holderChange), nob1 = Math.trunc(num(s1.numOrganicBuyers));
    const audit = (row.audit && typeof row.audit === "object") ? row.audit : {};
    const fp = row.firstPool || {};
    const poolTs = Date.parse(fp.createdAt || row.createdAt || "");
    const score = org * 12 + Math.log1p(Math.max(buyOrg, 0)) * 20 + Math.log1p(Math.max(hc1, 0)) * 40 + Math.log1p(Math.max(nob1, 0)) * 30;
    return {
      id, symbol: String(row.symbol || "?"), name: String(row.name || "?"),
      mcap: num(row.mcap || row.fdv), liq: num(row.liquidity), holders: Math.trunc(num(row.holderCount)),
      org, orgLabel: row.organicScoreLabel || null,
      hc5: num(s5.holderChange), hc1, hc6: num(s6.holderChange), hc24: num(s24.holderChange),
      nob1, pc1: num(s1.priceChange), pc6: num(s6.priceChange),
      buyOrg1h: buyOrg, buyVol1h: buyVol, orgBuyPct: buyVol > 0 ? (100 * buyOrg / buyVol) : null,
      topHolders: num(audit.topHoldersPercentage, null),
      poolCreated: Number.isFinite(poolTs) ? poolTs : null,
      poolAgeMin: Number.isFinite(poolTs) ? (Date.now() - poolTs) / 60000 : null,
      launchpad: row.launchpad || null, usdPrice: num(row.usdPrice), score, src,
    };
  }

  async function scanUniverse() {
    const byId = {}, sources = [];
    for (const p of CONFIG.LISTS) {
      const r = await fetchList(p);
      sources.push({ path: p, ok: r.ok, host: r.host, n: r.rows.length, err: r.err || null });
      for (const row of r.rows) {
        const c = rowToCand(row, p);
        if (c && (!byId[c.id] || c.score > byId[c.id].score)) byId[c.id] = c;
      }
    }
    return { cands: Object.values(byId).sort((a, b) => b.score - a.score), sources };
  }

  // Returns {verdict: PASS|SKIP|HELD, reasons:[plain English], note}
  function evaluate(c, ctx = {}) {
    const exM = new Set(ctx.excludeMints || CONFIG.EXCLUDE_MINTS);
    const exS = new Set((ctx.excludeSymbols || CONFIG.EXCLUDE_SYMBOLS).map((s) => String(s).toUpperCase()));
    const held = new Set(ctx.heldMints || []);
    const R = Object.assign({}, RULES, ctx.rules || {});
    const r = [];
    if (held.has(c.id)) return { verdict: "HELD", reasons: ["Already an open position"] };
    if (exM.has(c.id) || exS.has(c.symbol.toUpperCase())) r.push("On the exclude list (exited / rejected name)");
    if (c.org <= 0) r.push("No organic score");
    if (/Securities/i.test(c.name)) r.push("Tokenized security, not a meme");
    if (c.usdPrice > R.maxPrice && !String(c.launchpad || "").startsWith("pump")) r.push(`Price $${c.usdPrice.toFixed(2)} is above $1`);
    if (c.hc5 <= 0 || c.hc1 <= 0) r.push(`Holders not rising (5m ${fmtPct(c.hc5)}, 1h ${fmtPct(c.hc1)})`);
    else if (c.hc5 < R.minHc5Flat) r.push(`Holders about flat over 5m (${fmtPct(c.hc5)}), slowing`);
    if (c.hc6 < 0) r.push(`Holders falling over 6h (${fmtPct(c.hc6)})`);
    if (c.poolAgeMin != null && c.poolAgeMin < R.minPoolAgeMin) r.push(`Brand-new pool (${Math.round(c.poolAgeMin)} min old)`);
    if (c.orgBuyPct == null || c.orgBuyPct < R.minOrgBuyPct)
      r.push(`Bot-driven volume: only ${c.orgBuyPct == null ? "0" : c.orgBuyPct.toFixed(1)}% of 1h buys are organic ($${fmtK(c.buyOrg1h)} of $${fmtK(c.buyVol1h)})`);
    if (c.pc1 > R.maxPc1) r.push(`Pump chase: price up ${c.pc1.toFixed(0)}% in 1h`);
    if (c.topHolders != null && c.topHolders > R.maxTopHolders) r.push(`Top holders own ${c.topHolders.toFixed(0)}% (over ${R.maxTopHolders}%)`);
    if (c.nob1 < R.minNob1) r.push(`Thin organic demand: ${c.nob1} organic buyers in 1h`);
    if (r.length) return { verdict: "SKIP", reasons: r };
    return { verdict: "PASS", reasons: [`Holders rising (5m ${fmtPct(c.hc5)}, 1h ${fmtPct(c.hc1)}), ${c.orgBuyPct.toFixed(0)}% organic buying, ${c.nob1} organic buyers`] };
  }

  function bucketSummary(cands, ranges) {
    const ok = (c) => c.org > 0 && c.hc1 > 0 && c.hc5 > 0 && c.usdPrice <= 1.0;
    return ranges.map(([lo, hi]) => {
      const all = cands.filter((c) => c.mcap >= lo && c.mcap < hi);
      const g = all.filter(ok).sort((a, b) => b.score - a.score);
      return { lo, hi, total: all.length, rising: g.length, top: g.slice(0, 5) };
    });
  }

  // ---------- Solana RPC (read-only) ----------
  async function solRpc(method, params) {
    const errs = [];
    for (const { url, ct } of CONFIG.SOL_RPCS) {
      try {
        const j = await fetchJson(url, { method: "POST", headers: { "Content-Type": ct },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (j.error) throw new Error(j.error.message || "rpc error");
        return { result: j.result, url };
      } catch (e) { errs.push(hostOf(url) + ": " + e.message); }
    }
    throw new Error("All Solana RPCs failed - " + errs.join("; "));
  }

  // SOL balance: Solana RPC getBalance (fallback: Jupiter holdings).
  // SPL tokens: Jupiter holdings (fallback: RPC getTokenAccountsByOwner; many free RPCs block that method).
  async function getSolWallet(addr = CONFIG.SOL_WALLET) {
    const warn = []; let sol = null, rpc = null, tokens = null, tokenSrc = null, holdings = null;
    try { const b = await solRpc("getBalance", [addr]); sol = num(b.result && b.result.value) / 1e9; rpc = b.url; }
    catch (e) { warn.push(e.message); }
    try {
      holdings = await fetchJson(CONFIG.JUP_HOLDINGS + encodeURIComponent(addr));
      const agg = {};
      for (const [mint, accs] of Object.entries(holdings.tokens || {})) {
        for (const a of accs || []) {
          const t = agg[mint] || (agg[mint] = { mint, amount: 0, program: a.programId || null });
          t.amount += num(a.uiAmount);
        }
      }
      tokens = Object.values(agg); tokenSrc = "Jupiter holdings";
      if (sol == null) sol = num(holdings.uiAmount);
    } catch (e) { warn.push("Jupiter holdings: " + e.message); }
    if (tokens == null) {
      const agg = {};
      try {
        for (const prog of CONFIG.TOKEN_PROGRAMS) {
          const r = await solRpc("getTokenAccountsByOwner", [addr, { programId: prog }, { encoding: "jsonParsed" }]);
          for (const acc of (r.result && r.result.value) || []) {
            const info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
            if (!info) continue;
            const t = agg[info.mint] || (agg[info.mint] = { mint: info.mint, amount: 0, program: prog });
            t.amount += num(info.tokenAmount && info.tokenAmount.uiAmount);
          }
          rpc = rpc || r.url;
        }
        tokens = Object.values(agg); tokenSrc = "Solana RPC";
      } catch (e) { warn.push(e.message); }
    }
    if (sol == null && tokens == null) throw new Error(warn.join("; ") || "wallet read failed");
    return { sol, tokens: tokens || [], tokensOk: tokens != null, tokenSrc, rpc, warn };
  }

  async function getPrices(mints) {
    const out = {};
    for (let i = 0; i < mints.length; i += 50) {
      const d = await fetchJson(CONFIG.JUP_PRICE + "?ids=" + mints.slice(i, i + 50).join(","));
      for (const [k, v] of Object.entries(d || {})) if (v && v.usdPrice != null) out[k] = num(v.usdPrice);
    }
    return out;
  }

  async function getTokenInfo(mints) {
    const out = {};
    for (let i = 0; i < mints.length; i += 50) {
      let d = null;
      for (const host of CONFIG.JUP_HOSTS) {
        try { d = await fetchJson(host + "/search?query=" + mints.slice(i, i + 50).join(",")); break; } catch (e) { /* next */ }
      }
      for (const row of d || []) { const c = rowToCand(row, "search"); if (c) out[c.id] = c; }
    }
    return out;
  }

  // ---------- Arc (EVM) read-only ----------
  async function arcRpc(method, params) {
    const j = await fetchJson(CONFIG.ARC_RPC, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  }

  async function getArcUsdc(addr = CONFIG.ARC_WALLET) {
    const data = "0x70a08231" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0"); // balanceOf(addr)
    try {
      const res = await arcRpc("eth_call", [{ to: CONFIG.ARC_USDC, data }, "latest"]);
      return { usdc: Number(BigInt(res)) / 1e6, method: "eth_call balanceOf (USDC 0x3600..., 6 dp)" };
    } catch (e) {
      const res = await arcRpc("eth_getBalance", [addr, "latest"]); // native USDC gas balance, 18 dp
      return { usdc: Number(BigInt(res)) / 1e18, method: "eth_getBalance (native USDC, 18 dp)", warn: e.message };
    }
  }

  // ---------- formatting ----------
  function fmtPct(v, dp = 2) {
    if (v == null || !Number.isFinite(v)) return "-";
    if (Math.abs(v) >= 10000) return (v > 0 ? "+" : "") + "new";
    return (v > 0 ? "+" : "") + v.toFixed(Math.abs(v) >= 100 ? 0 : dp) + "%";
  }
  function fmtK(v) {
    v = num(v);
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "k";
    return v.toFixed(0);
  }
  function fmtUsd(v, dp = 2) {
    if (v == null || !Number.isFinite(v)) return "-";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtAge(min) {
    if (min == null) return "-";
    if (min < 60) return Math.round(min) + "m";
    if (min < 2880) return (min / 60).toFixed(1) + "h";
    return Math.round(min / 1440) + "d";
  }
  function nowEt(d = new Date()) {
    return d.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET";
  }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }

  const api = { CONFIG, RULES, num, fetchJson, fetchList, rowToCand, scanUniverse, evaluate, bucketSummary,
    solRpc, getSolWallet, getPrices, getTokenInfo, arcRpc, getArcUsdc,
    fmtPct, fmtK, fmtUsd, fmtAge, nowEt, hostOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrganicCore = api;
})(typeof window !== "undefined" ? window : globalThis);
