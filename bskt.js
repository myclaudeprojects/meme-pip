// BSKT tab (owner 2026-10-11): read-only view of bskt.json written on the box by bskt_recorder.py (~15 min).
// Self-contained: does not touch the positions/scanner code in app.js. No keys, no signing, no external calls.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TZ = "America/New_York";
  const B = { data: null, mode: "day", loading: false, last: 0, err: null };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => (v == null || isNaN(v) ? null : Number(v));
  function fN(v, d) { v = num(v); if (v == null) return "–"; const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B"; if (a >= 1e6) return (v / 1e6).toFixed(2) + "M"; if (a >= 1e4) return (v / 1e3).toFixed(1) + "k";
    return v.toLocaleString(undefined, { maximumFractionDigits: d == null ? 0 : d }); }
  function fUsd(v) { v = num(v); if (v == null) return "–"; if (Math.abs(v) < 0.01 && v !== 0) return "$" + v.toPrecision(3); return "$" + fN(v, v < 100 ? 2 : 0); }
  const fmtT = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fmtH = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric" });
  const dayET = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  function ago(t) { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago"; }
  const dLabel = (d) => { const [y, m, dd] = d.split("-"); return +m + "/" + +dd; };
  const hLabel = (h) => { const x = +h.slice(11, 13); return (x % 12 || 12) + (x < 12 ? "a" : "p"); };

  // ------------------------------------------------------------------ tabs
  function show(view) {
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $("view-main").hidden = view !== "main"; $("view-bskt").hidden = view !== "bskt";
    if (view === "bskt") { if (location.hash !== "#bskt") history.replaceState(null, "", "#bskt"); load(false); }
    else if (location.hash === "#bskt") history.replaceState(null, "", location.pathname + location.search);
  }
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  window.addEventListener("hashchange", () => show(location.hash === "#bskt" ? "bskt" : "main"));

  async function load(force) {
    if (B.loading || (!force && B.data && Date.now() - B.last < 60000)) return;
    B.loading = true;
    try {
      const r = await fetch("bskt.json?t=" + Math.floor(Date.now() / 60000), { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      B.data = await r.json(); B.err = null; B.last = Date.now();
    } catch (e) { B.err = e.message; }
    B.loading = false; render();
  }
  setInterval(() => { if (!$("view-bskt").hidden) load(false); }, 30000);

  // ------------------------------------------------------------------ charts (inline SVG, no libraries)
  function axisMax(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function bars(labels, series, o) {
    o = o || {}; const W = 480, H = 210, L = 44, R = 6, T = 10, Bm = 26, n = labels.length, FS = 13;
    if (!n) return '<div class="muted bk-empty">No data yet.</div>';
    const tot = labels.map((_, i) => o.stacked ? series.reduce((s, se) => s + (se.v[i] || 0), 0) : Math.max(...series.map((se) => se.v[i] || 0)));
    const hi = axisMax(Math.max(...tot)), Y = (v) => T + (1 - v / hi) * (H - T - Bm), slot = (W - L - R) / n, bw = Math.min(slot, 56), pad = (slot - bw) / 2;
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = hi * i / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#30363d" stroke-dasharray="3 3"/><text x="${L - 5}" y="${(y + 4).toFixed(1)}" fill="#8b949e" font-size="${FS}" text-anchor="end">${fN(v)}</text>`; }
    const every = Math.max(1, Math.ceil(n / 7));
    labels.forEach((lb, i) => {
      const x0 = L + i * slot + pad; let base = 0;
      const tip = `${lb.full || lb.t}: ` + series.map((se) => `${se.name} ${fN(se.v[i], o.dec)}`).join(", ");
      series.forEach((se, k) => {
        const v = se.v[i] || 0; if (!v) return;
        let x, w, y0, y1;
        if (o.stacked) { x = x0 + bw * 0.12; w = bw * 0.76; y1 = Y(base + v); y0 = Y(base); base += v; }
        else { const sw = bw * 0.8 / series.length; x = x0 + bw * 0.1 + k * sw; w = sw; y1 = Y(v); y0 = Y(0); }
        g += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" fill="${se.c}" rx="1.5"><title>${esc(tip)}</title></rect>`;
      });
      g += `<rect x="${x0.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - Bm}" fill="transparent"><title>${esc(tip)}</title></rect>`;
      if (i % every === 0 || i === n - 1) g += `<text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 9}" fill="#8b949e" font-size="${FS}" text-anchor="middle">${esc(lb.t)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bk-svg" preserveAspectRatio="xMidYMid meet">${g}</svg>` + legend(series);
  }
  function lines(xs, series, o) {   // xs: numbers (ms) ; series: [{name,c,v:[...] }]
    o = o || {}; const W = 480, H = 210, L = 56, R = 6, T = 10, Bm = 26, FS = 13;
    const pts = series.map((se) => xs.map((x, i) => [x, num(se.v[i])]).filter((p) => p[1] != null));
    if (!pts.some((p) => p.length)) return '<div class="muted bk-empty">' + (o.empty || "No samples yet.") + "</div>";
    const allV = pts.flat().map((p) => p[1]); let lo = Math.min(...allV), hi = Math.max(...allV);
    if (hi === lo) { hi = hi * 1.05 + 1; lo = Math.max(0, lo * 0.95 - 1); }
    const x0 = o.x0 != null ? o.x0 : Math.min(...xs), x1 = o.x1 != null ? o.x1 : Math.max(...xs, x0 + 1);
    const X = (x) => L + (x - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - Bm);
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#30363d" stroke-dasharray="3 3"/><text x="${L - 5}" y="${(y + 4).toFixed(1)}" fill="#8b949e" font-size="${FS}" text-anchor="end">${o.usd ? fUsd(v) : fN(v)}</text>`; }
    for (let i = 0; i <= 4; i += 2) { const x = x0 + (x1 - x0) * i / 4; g += `<text x="${X(x).toFixed(1)}" y="${H - 9}" fill="#8b949e" font-size="${FS}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${esc(o.xfmt ? o.xfmt(x) : fmtT.format(x))}</text>`; }
    series.forEach((se, k) => {
      const p = pts[k]; if (!p.length) return;
      if (p.length > 1) g += `<polyline fill="none" stroke="${se.c}" stroke-width="2" points="${p.map((q) => X(q[0]).toFixed(1) + "," + Y(q[1]).toFixed(1)).join(" ")}"/>`;
      const step = Math.max(1, Math.ceil(p.length / 60));
      p.forEach((q, i) => { if (i % step === 0 || i === p.length - 1) g += `<circle cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="${p.length > 30 ? 1.8 : 3}" fill="${se.c}"><title>${esc((o.xfmt ? o.xfmt(q[0]) : fmtT.format(q[0])) + " ET: " + se.name + " " + (o.usd ? fUsd(q[1]) : fN(q[1])))}</title></circle>`; });
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bk-svg" preserveAspectRatio="xMidYMid meet">${g}</svg>` + legend(series);
  }
  const legend = (series) => '<div class="bk-leg">' + series.map((s) => `<span><i style="background:${s.c}"></i>${esc(s.name)}</span>`).join("") + "</div>";

  // ------------------------------------------------------------------ data helpers
  function dayRange(d, n) {   // last n ET days ending today
    const out = [], t = new Date(d.today_et + "T12:00:00Z").getTime();
    for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
    return out;
  }
  const byKey = (arr, k) => { const m = {}; (arr || []).forEach((x) => { m[x[k]] = x; }); return m; };
  function hoursToday(d) { const now = new Date(d.generated_ts * 1000), hNow = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now);
    const out = []; for (let h = 0; h <= hNow; h++) out.push(d.today_et + "T" + String(h).padStart(2, "0")); return out; }
  function firstDay(d) { const st = d.stats || {}; const ds = [...(st.daily || []).map((x) => x.day), ...(d.chainDaily || []).map((x) => x.day)].sort(); return ds[0] || d.today_et; }

  // ------------------------------------------------------------------ render
  function card(k, v, s, cls) { return `<div class="card"><div class="k">${k}</div><div class="v ${cls || ""}">${v}</div><div class="s">${s || ""}</div></div>`; }
  function render() {
    const root = $("bskt-root"); if (!root) return;
    const d = B.data;
    if (!d) { root.innerHTML = B.err ? `<div class="msg err">Could not load bskt.json: ${esc(B.err)}</div>` : '<span class="muted">Loading…</span>'; return; }
    const st = d.stats, m = d.market || {}, e = d.economy || {}, w = d.wallets || {}, p = d.pace || {};
    const today = d.today_et, td = st ? byKey(st.daily, "day")[today] || {} : {}, tw = st ? byKey(st.withdrawalsDaily, "day")[today] || {} : {};
    const T = st ? st.totals || {} : {};
    const age = Date.now() / 1000 - d.generated_ts;
    let h = "";
    const errs = Object.entries(d.errors || {});
    h += `<div class="bk-top"><span class="muted">Snapshot ${esc(d.generated_et)} (${ago(d.generated_ts * 1000)}) · updates every ~15 min · days/hours in ET</span>` +
      `<span class="bk-links"><a href="https://playbskt.com" target="_blank" rel="noopener">playbskt.com</a> · <a href="${esc(m.link || "#")}" target="_blank" rel="noopener">Bordrless</a> · <button id="bk-refresh">Reload</button></span></div>`;
    if (age > 45 * 60) h += `<div class="msg">Snapshot is ${Math.round(age / 60)} min old: the box recorder may be paused.</div>`;
    if (errs.length) h += `<div class="msg">Some sources failed on the last snapshot: ${errs.map(([k, v]) => esc(k + ": " + v)).join(" · ")}</div>`;

    // headline cards
    const earnedT = st ? (td.earnedBskt || 0) + (td.earnedJuke || 0) : null;
    const capPct = e.cap ? (e.credited || 0) / e.cap * 100 : null;
    const ch = num(m.change24);
    const holdT0 = (d.series || []).find((s) => dayET(s.t * 1000) === today && s.holders != null);
    const hDelta = holdT0 && m.holders != null ? m.holders - holdT0.holders : null;
    h += '<div class="grid bk-cards">';
    h += card("Online now", `<span id="bsktOnl">${window.__bsktOnl ? fN(window.__bsktOnl.online) : "–"}</span>`, `<span id="bsktOnlS">${window.__bsktOnlS || "live from the game API (last 90 s)"}</span>`);
    h += card("Players today", st ? fN(td.players || 0) : "–", st ? `new ${fN(td.newPlayers || 0)} · returning ${fN((td.players || 0) - (td.newPlayers || 0))}` : "stats endpoint unavailable");
    h += card("Players all-time", st ? fN(T.players) : "–", st ? `wallets connected ${fN(T.wallets)} · guests ${fN(T.guests)}` : "");
    h += card("Runs today", st ? fN((td.runsBskt || 0) + (td.runsJuke || 0)) : "–", st ? `BSKT Ball ${fN(td.runsBskt || 0)} · Juke Run ${fN(td.runsJuke || 0)}` + (td.bonusHits ? ` · ${td.bonusHits} bonus hits` : "") : "");
    const fHM = (m) => { m = Math.round(m || 0); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`; };   // playtime (owner 2026-10-28)
    h += card("Playtime today", st && td.playMin != null ? fHM(td.playMin) : "–", st && td.playMin != null ? `avg ${fN(Math.round(td.avgRunSecs || 0))} s/run · BSKT Ball ${fHM(td.playMinBskt)} · Juke Run ${fHM(td.playMinJuke)}` : "waiting for the stats endpoint");
    h += card("BSKT earned today", st ? fN(earnedT) : "–", st ? `BSKT Ball ${fN(td.earnedBskt || 0)} · Juke ${fN(td.earnedJuke || 0)} (ET day)` : "");
    h += card("BSKT withdrawn today", st ? fN(tw.bskt || 0) : fN(e.sent), st ? `${fN(tw.n || 0)} withdrawals today · game day (UTC) sent ${fN(e.sent)}` : "game day (UTC) sent");
    h += card("Withdrawn all-time", st ? fN(T.withdrawnBskt) : "–", st ? `${fN(T.withdrawals)} withdrawals` + (T.withdrawalsInFlight ? ` · ${T.withdrawalsInFlight} in flight` : "") + (T.withdrawalsFailed ? ` · ${T.withdrawalsFailed} failed` : "") : "");
    h += card("Rewards wallet left", fN(w.rewardsBskt) + " <small class=muted>BSKT</small>", (p.runwayDaysRewards ? `<b>~${fN(p.runwayDaysRewards)} days</b> runway at ${fN(p.bsktPerDay)} BSKT/day` : "runway: no pace yet") + ` · inventory incl. payout wallet ${fN(e.inventory)}`);
    const F = st && st.farm;   // farm / held split (owner 2026-10-14): headline numbers above already exclude held/farm accounts
    if (F) {
      const B = F.batch || {}, L = B.last;
      h += card("Earned today: legit vs farm", fN(F.earnedTodayLegit), `held/farm accounts ${fN(F.earnedTodayFarm)} (excluded from headline)`);
      h += card("Withdrawn today: legit vs farm", fN(F.withdrawnTodayLegit), `${fN(F.withdrawnTodayLegitN)} legit · farm ${fN(F.withdrawnTodayFarm)} (${fN(F.withdrawnTodayFarmN)}) · farm all-time ${fN(F.farmWithdrawnAll)}`);
      h += card("Withdrawal SOL", (F.feeSolCollected || 0).toFixed(4) + " <small class=muted>SOL collected</small>", `${fN(F.feeTxN || 0)} approvals · payout cost ${(F.feePayoutCostSol || 0).toFixed(4)} SOL · forwarded to 8GvB…WhHp ${(F.feeForwardedSol || 0).toFixed(4)} SOL · 8GvB balance ${F.creatorWalletSol == null ? "n/a" : F.creatorWalletSol.toFixed(4) + " SOL"}`);
      h += card("Held (farm/review)", fN(F.heldBskt) + " <small class=muted>BSKT</small>", `${fN(F.heldWithdrawals)} withdrawals · ${fN(F.heldAccounts)} accounts · unwithdrawn balance ${fN(F.heldClaimableBskt)} · ${fN(F.bannedWallets)} wallets banned · ${fN(F.blockedIps)} IPs blocked`);
      h += card("Withdrawal batches", `${fN(B.delayed)} waiting`, `${fN(B.delayedBskt)} BSKT in ${B.delayH}h delay · queued to pay ${fN(B.queued)} (${fN(B.queuedBskt)}) · next batch ${B.nextAt ? new Date(B.nextAt).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) + " ET" : "–"}` + (L ? ` · last: ${L.released} paid / ${L.held} held` : ""));
    }
    h += card("Token price", fUsd(m.price), ch == null ? "" : `<span class="${ch >= 0 ? "pos" : "neg"}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</span> 24h · ${esc(m.status || "")}${m.progress != null ? " " + (m.progress * 100).toFixed(1) + "% to graduation" : ""}`);
    h += card("Market cap", fUsd(m.mcap), `liquidity ${fUsd(m.liquidityUsd)}`);
    h += card("Holders", fN(m.holders), hDelta == null ? "Bordrless holder count" : `${hDelta >= 0 ? "+" : ""}${hDelta} today · Bordrless count`);
    h += card("24h volume", fUsd(m.vol24), `${fN(m.trades24)} trades in 24h` + (m.lastTradeAt ? ` · last ${ago(m.lastTradeAt * 1000)}` : ""));
    h += card("Global cap today", capPct == null ? "–" : capPct.toFixed(capPct < 1 ? 2 : 1) + "%", `${fN(e.credited)} of ${fN(e.cap)} BSKT credited (UTC day, resets 8 PM ET)` + (e.capHit ? ' · <span class="neg">CAP HIT</span>' : "") + (e.pending ? ` · ${fN(e.pending)} pending` : ""), capPct > 80 ? "warn" : "");
    h += "</div>";

    // trends
    // mode popularity (owner 2026-10-12 11:36 PM ET)
    if (st && Array.isArray(st.modes)) {
      const ML = { freeplay: "BSKT Ball · Free Play", adventure: "BSKT Ball · Adventure", battle_pvp: "BSKT Ball · Battle vs player", battle_bot: "BSKT Ball · Battle vs bot", jukerun: "Juke Run", duel_pvp: "Quick Draw vs player", duel_bot: "Quick Draw vs bot" };
      const rows = Object.keys(ML).map((k) => Object.assign({ k }, st.modes.find((r) => r.k === k) || {})), mx = Math.max(1, ...rows.map((r) => r.plays7d || 0));
      rows.sort((a, b) => (b.plays7d || 0) - (a.plays7d || 0) || (b.playsAll || 0) - (a.playsAll || 0));
      h += '<section><h2>Modes <small>plays (players) · sorted by last 7 days · BSKT Ball/Juke = finished runs, players = accounts · Battle/Quick Draw = match starts, players = devices/IPs, tracked since Oct 12 ~11:40 PM ET</small></h2><div class="wrap"><table><thead><tr><th>Mode</th><th>Today</th><th>7 days</th><th>All time</th><th></th></tr></thead><tbody>';
      for (const r of rows) h += `<tr><td>${esc(ML[r.k])}</td><td>${fN(r.playsToday || 0)} <span class="muted">(${fN(r.playersToday || 0)})</span></td><td>${fN(r.plays7d || 0)} <span class="muted">(${fN(r.players7d || 0)})</span></td><td>${fN(r.playsAll || 0)} <span class="muted">(${fN(r.playersAll || 0)})</span></td><td style="min-width:90px"><div style="height:8px;border-radius:4px;background:#f7931a;width:${Math.round((r.plays7d || 0) / mx * 100)}%"></div></td></tr>`;
      h += "</tbody></table></div></section>";
    }
    h += `<section><h2>Trends <small>${B.mode === "day" ? "by day (ET)" : "today by hour (ET)"}</small>
      <span class="bk-seg"><button data-bkmode="day" class="${B.mode === "day" ? "on" : ""}">By day</button><button data-bkmode="hour" class="${B.mode === "hour" ? "on" : ""}">Today by hour</button></span></h2>`;
    h += '<div class="bk-charts">' + charts(d) + "</div></section>";

    // ref links
    h += '<section><h2>Creator ref links <small>playbskt.com/?ref=code · welcome bonus per new player</small></h2><div class="bk-ref">';
    if (st && st.ref) {
      h += '<div class="wrap"><table><thead><tr><th class="l">Code</th><th>Visits</th><th>Unique</th><th>Signups</th><th>Players</th><th>Wallets</th><th>Bonuses paid</th><th>BSKT paid</th><th>Pending</th><th>Runs</th><th>BSKT earned</th></tr></thead><tbody>';
      // hide inactive codes (owner 2026-10-15: Parallax write-off — active=false must not appear on the creator dashboard)
      const codes = (st.ref.codes || []).filter((c) => c.active !== false).slice().sort((a, b) => b.signups - a.signups || b.visits - a.visits);
      codes.forEach((c) => { h += `<tr><td class="l"><b>${esc(c.code)}</b>${c.video ? ` <a class="muted" href="${esc(c.video)}" target="_blank" rel="noopener" title="${esc((c.creator || "") + (c.publishedEt ? " · published " + c.publishedEt + " ET" : ""))}">▶ video</a>` : ""}${c.ytViews != null ? ` <a class="muted" href="${esc((c.ytVideos && c.ytVideos[0] && c.ytVideos[0].url) || c.video || "#")}" target="_blank" rel="noopener" title="${esc("YouTube views (refreshed by the box recorder)" + (c.ytVideos || []).map((v) => "\n" + v.url + ": " + (v.views == null ? "n/a" : fN(v.views)) + (v.title ? " · " + v.title : "")).join(""))}">· ${fN(c.ytViews)} YT views</a>` : ""}${c.registered === false ? ' <span class="muted" title="code not in the API ref_codes table yet, so visits/signups are not counted">(not registered)</span>' : ""}</td><td>${fN(c.visits)}</td><td>${fN(c.uniqueVisitors)}</td><td>${fN(c.signups)}</td><td>${fN(c.players)}</td><td>${fN(c.wallets)}</td><td>${fN(c.bonusesPaid)}</td><td>${fN(c.bonusPaidBskt)}</td><td>${fN(c.bonusesPending)}</td><td>${fN(c.verifiedRuns)}</td><td>${fN(c.pointsEarned)}</td></tr>`; });
      const sum = (k) => codes.reduce((s, c) => s + (num(c[k]) || 0), 0);
      if (codes.length > 1) h += `<tr class="bk-sum"><td class="l">Total</td><td>${fN(sum("visits"))}</td><td>${fN(sum("uniqueVisitors"))}</td><td>${fN(sum("signups"))}</td><td>${fN(sum("players"))}</td><td>${fN(sum("wallets"))}</td><td>${fN(sum("bonusesPaid"))}</td><td>${fN(sum("bonusPaidBskt"))}</td><td>${fN(sum("bonusesPending"))}</td><td>${fN(sum("verifiedRuns"))}</td><td>${fN(sum("pointsEarned"))}</td></tr>`;
      h += "</tbody></table></div>";
      h += refTrend(d);
      h += "</div>";
    } else h += '<div class="muted">Ref stats come from the API stats endpoint, which did not answer on the last snapshot.</div></div>';
    h += "</section>";

    // leaderboards
    h += '<section><h2>Leaderboards <small>top 5 per game</small></h2><div class="bk-lb">';
    [["bsktball", "BSKT Ball"], ["jukerun", "Juke Run"]].forEach(([k, name]) => {
      const rows = (d.leaderboards || {})[k] || [];
      h += `<div><div class="bk-lbh">${name}</div><table><tbody>` + (rows.length ? rows.map((r, i) => `<tr><td class="l muted">${i + 1}</td><td class="l"><b>${esc(r.name)}</b></td><td>${fN(r.score)}</td></tr>`).join("") : '<tr><td class="l muted">No scores yet</td></tr>') + "</tbody></table></div>";
    });
    h += "</div>";
    // economy facts
    const j = e.juke || {};
    h += `<div class="muted bk-facts">Juke Run: ${fN(j.pointsPerBskt)} pts = 1 BSKT, ${fN(j.lanes)} lanes, 10x bonus needs ≥${fN(j.bonusMinTds)} TDs · BSKT Ball bonus: ${e.bonus ? (e.bonus.probBps / 100) + "% chance of " + e.bonus.multiplier + "x (≥" + e.bonus.minMakes + " makes)" : "–"} · wallet cap ${fN(e.walletDailyCap)}/day · global cap ${e.globalDailyCapBps != null ? e.globalDailyCapBps / 100 + "% of inventory/day" : "–"} · users credited today (UTC) ${fN(e.usersCredited)}` +
      ((e.sweeps || []).length ? ` · last sweep ${fmtT.format(new Date(e.sweeps[0].at))} ET (${fN(e.sweeps[0].rewardsSol, 3)} SOL to rewards)` : "") +
      ((e.topups || []).length ? ` · last top-up ${fmtT.format(new Date(e.topups[0].at))} ET (${fN(e.topups[0].bskt)} BSKT to payout)` : "") + "</div>";
    h += "</section>";

    // feed
    h += '<section><h2>Recent activity <small>claims (BSKT earned by runs, welcome bonuses), withdrawals, buys and sells</small></h2><div class="wrap"><table><thead><tr><th class="l">When (ET)</th><th class="l">Type</th><th class="l">Wallet</th><th>BSKT</th><th class="l">Detail</th></tr></thead><tbody>';
    const KIND = { claim: ["CLAIM", "bk-claim"], welcome: ["WELCOME", "bk-claim"], withdraw: ["WITHDRAW", "bk-wd"], buy: ["BUY", "PASS"], sell: ["SELL", "SKIP"] };
    const feed = (d.feed || []).slice(0, 60);
    if (!feed.length) h += '<tr><td class="l muted" colspan="5">No recent activity.</td></tr>';
    feed.forEach((x) => {
      const t = new Date(x.at).getTime(), k = KIND[x.kind] || [x.kind, ""];
      let det = "";
      if (x.kind === "claim") det = `${x.game === "jukerun" ? "Juke Run" : "BSKT Ball"} score ${fN(x.score)}${x.mult > 1 ? ` · <b class="warn">${x.mult}x bonus</b>` : ""}`;
      else if (x.kind === "welcome") det = `ref ${esc(x.code)} · ${esc(x.status)}`;
      else if (x.kind === "withdraw") det = esc(x.status || "");
      else det = `${fN(x.sol, 3)} SOL · ${fUsd(x.usd)}`;
      h += `<tr><td class="l" title="${esc(fmtT.format(t))} ET">${esc(fmtT.format(t))} <span class="muted">${ago(t)}</span></td><td class="l"><span class="badge ${k[1]}">${k[0]}</span></td><td class="l">${esc(x.who || "")}</td><td>${fN(x.bskt)}</td><td class="l">${det}</td></tr>`;
    });
    h += "</tbody></table></div></section>";
    h += `<div class="muted bk-facts">Sources: btc-basket-api /economy, /scores, /activity and the token-protected read-only /admin/stats (aggregates); Bordrless API for price, market cap, holders, volume and trades. Rewards wallet <a href="https://solscan.io/account/${esc(w.rewards)}" target="_blank" rel="noopener">${esc((w.rewards || "").slice(0, 4))}…</a> · payout wallet <a href="https://solscan.io/account/${esc(w.payout)}" target="_blank" rel="noopener">${esc((w.payout || "").slice(0, 4))}…</a>. Runway = rewards wallet ÷ ${esc(p.basis || "pace")}. Holder history starts when the recorder started (Bordrless has no holder history); market cap before that is from Bordrless trade prices.</div>`;
    root.innerHTML = h;
    root.querySelectorAll("[data-bkmode]").forEach((b) => b.addEventListener("click", () => { B.mode = b.dataset.bkmode; render(); }));
    const rb = $("bk-refresh"); if (rb) rb.addEventListener("click", () => load(true));
  }

  function chartBox(title, body, note) { return `<div class="bk-chart"><div class="bk-ct">${title}${note ? ` <small class="muted">${note}</small>` : ""}</div>${body}</div>`; }
  function charts(d) {
    const st = d.stats || {}, C = { new: "#3fb950", ret: "#58a6ff", bskt: "#d29922", juke: "#bc8cff", earn: "#3fb950", wd: "#f85149", buy: "#3fb950", sell: "#f85149", hold: "#58a6ff", mc: "#d29922" };
    let out = "";
    if (B.mode === "day") {
      const f = firstDay(d), all = dayRange(d, 60).filter((x) => x >= f), labels = all.map((x) => ({ t: dLabel(x), full: x }));
      const D = byKey(st.daily, "day"), Wd = byKey(st.withdrawalsDaily, "day"), CD = byKey(d.chainDaily, "day");
      const g = (map, k) => all.map((x) => (map[x] || {})[k] || 0);
      if (d.stats) {
        out += chartBox("Active players", bars(labels, [{ name: "New", c: C.new, v: g(D, "newPlayers") }, { name: "Returning", c: C.ret, v: all.map((x) => ((D[x] || {}).players || 0) - ((D[x] || {}).newPlayers || 0)) }], { stacked: true }));
        out += chartBox("Runs per game", bars(labels, [{ name: "BSKT Ball", c: C.bskt, v: g(D, "runsBskt") }, { name: "Juke Run", c: C.juke, v: g(D, "runsJuke") }], { stacked: true }));
        out += chartBox("Playtime (minutes)", bars(labels, [{ name: "BSKT Ball", c: C.bskt, v: g(D, "playMinBskt") }, { name: "Juke Run", c: C.juke, v: g(D, "playMinJuke") }], { stacked: true }), "finished runs, wall-clock");
        out += chartBox("BSKT earned vs withdrawn", bars(labels, [{ name: "Earned", c: C.earn, v: all.map((x) => ((D[x] || {}).earnedBskt || 0) + ((D[x] || {}).earnedJuke || 0)) }, { name: "Withdrawn", c: C.wd, v: g(Wd, "bskt") }], {}));
      } else out += chartBox("Players / runs / BSKT earned", '<div class="muted bk-empty">Stats endpoint unavailable on the last snapshot.</div>');
      const xs = all.map((x) => new Date(x + "T12:00:00Z").getTime());
      out += chartBox("Holders", lines(xs, [{ name: "Holders", c: C.hold, v: all.map((x) => (CD[x] || {}).holders) }], { xfmt: (t) => dLabel(new Date(t).toISOString().slice(0, 10)), empty: "Holder history starts with the recorder." }), "end of day");
      out += chartBox("Market cap", lines(xs, [{ name: "Market cap", c: C.mc, v: all.map((x) => (CD[x] || {}).mcap) }], { usd: true, xfmt: (t) => dLabel(new Date(t).toISOString().slice(0, 10)) }), "end of day");
      out += chartBox("Buys / sells", bars(labels, [{ name: "Buys", c: C.buy, v: g(CD, "buys") }, { name: "Sells", c: C.sell, v: g(CD, "sells") }], {}));
    } else {
      const hrs = hoursToday(d), labels = hrs.map((x) => ({ t: hLabel(x), full: x.replace("T", " ") + ":00 ET" }));
      const H = byKey(st.hourly, "hour"), Wh = byKey(st.withdrawalsHourly, "hour"), TH = byKey(d.tradesHourly, "hour");
      const g = (map, k) => hrs.map((x) => (map[x] || {})[k] || 0);
      if (d.stats) {
        out += chartBox("Active players", bars(labels, [{ name: "New", c: C.new, v: g(H, "newPlayers") }, { name: "Returning", c: C.ret, v: hrs.map((x) => ((H[x] || {}).players || 0) - ((H[x] || {}).newPlayers || 0)) }], { stacked: true }), "distinct per hour");
        out += chartBox("Runs per game", bars(labels, [{ name: "BSKT Ball", c: C.bskt, v: g(H, "runsBskt") }, { name: "Juke Run", c: C.juke, v: g(H, "runsJuke") }], { stacked: true }));
        out += chartBox("Playtime (minutes)", bars(labels, [{ name: "BSKT Ball", c: C.bskt, v: g(H, "playMinBskt") }, { name: "Juke Run", c: C.juke, v: g(H, "playMinJuke") }], { stacked: true }), "finished runs, wall-clock");
        out += chartBox("BSKT earned vs withdrawn", bars(labels, [{ name: "Earned", c: C.earn, v: hrs.map((x) => ((H[x] || {}).earnedBskt || 0) + ((H[x] || {}).earnedJuke || 0)) }, { name: "Withdrawn", c: C.wd, v: g(Wh, "bskt") }], {}));
      } else out += chartBox("Players / runs / BSKT earned", '<div class="muted bk-empty">Stats endpoint unavailable on the last snapshot.</div>');
      const ser = (d.series || []).filter((s) => dayET(s.t * 1000) === d.today_et), xs = ser.map((s) => s.t * 1000);
      const hf = (t) => fmtH.format(t);
      const nowMs = d.generated_ts * 1000, hm = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(nowMs);
      const mid = nowMs - ((+hm.find((q) => q.type === "hour").value) * 60 + (+hm.find((q) => q.type === "minute").value)) * 60000, xr = { x0: mid, x1: Math.max(nowMs, mid + 3600e3) };
      out += chartBox("Holders", lines(xs, [{ name: "Holders", c: C.hold, v: ser.map((s) => s.holders) }], Object.assign({ xfmt: hf, empty: "No samples today yet." }, xr)), "15-min samples");
      out += chartBox("Market cap", lines(xs, [{ name: "Market cap", c: C.mc, v: ser.map((s) => s.mcap) }], Object.assign({ usd: true, xfmt: hf, empty: "No samples today yet." }, xr)), "15-min samples");
      out += chartBox("Buys / sells", bars(labels, [{ name: "Buys", c: C.buy, v: g(TH, "buys") }, { name: "Sells", c: C.sell, v: g(TH, "sells") }], {}));
    }
    return out;
  }
  function refTrend(d) {
    const st = d.stats; if (!st || !st.ref || !(st.ref.daily || []).length) return "";
    const f = firstDay(d), all = dayRange(d, 60).filter((x) => x >= f), labels = all.map((x) => ({ t: dLabel(x), full: x }));
    const active = new Set((st.ref.codes || []).filter((c) => c.active !== false).map((c) => c.code));
    const codes = [...new Set(st.ref.daily.map((r) => r.code).filter((c) => !active.size || active.has(c)))], cols = ["#d29922", "#bc8cff", "#3fb950", "#58a6ff", "#f85149", "#79c0ff"];
    const v = (code) => all.map((x) => { const r = st.ref.daily.find((q) => q.code === code && q.day === x); return r ? r.signups : 0; });
    return '<div class="bk-chart"><div class="bk-ct">Signups per day by creator</div>' + bars(labels, codes.map((c, i) => ({ name: c, c: cols[i % cols.length], v: v(c) })), { stacked: true }) + "</div>";
  }

  show(location.hash === "#bskt" ? "bskt" : "main");
})();

// live "Online now" (owner 2026-10-13): GET /online from the game API every 30 s, straight from the browser (CORS *)
(function () {
  const fmt = n => Number(n || 0).toLocaleString("en-US");
  async function tick() {
    try {
      const j = await (await fetch("https://btc-basket-api.onrender.com/online", { cache: "no-store" })).json();
      const b = j.byMode || {}; window.__bsktOnl = j;
      window.__bsktOnlS = `BSKT Ball ${fmt(b.bsktball)} · Juke ${fmt(b.jukerun)} · Quick Draw ${fmt(b.duel)} · Battle ${fmt(b.battle)}`;
    } catch (e) { window.__bsktOnlS = "game API unreachable"; }
    const v = document.getElementById("bsktOnl"), s = document.getElementById("bsktOnlS");
    if (v) v.textContent = window.__bsktOnl ? fmt(window.__bsktOnl.online) : "–"; if (s) s.textContent = window.__bsktOnlS;
  }
  tick(); setInterval(tick, 30000);
})();
