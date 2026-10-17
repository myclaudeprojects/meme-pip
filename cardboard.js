/* Cardboard card (2026-10-17). Read-only. Shows the Cardboard farm burner's CARDBOARD staked + balances.
   Source: box-written cardboard.json (cardboard_snapshot.py reads the public cardboardtrade.xyz API; that API is CORS-locked to its own site).
   Re-fetched every 60s (same as the wallet cadence) and on the Refresh button. Independent of app.js. */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("c-cb")) return;
  const n = (x, d) => (Number(x) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const cb = (x) => { x = Number(x) || 0; return x >= 100 ? n(x, 0) : n(x, 2); };
  const et = (ts) => new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
  async function load() {
    let d = null;
    try { const r = await fetch("cardboard.json?ts=" + Date.now(), { cache: "no-store" }); if (r.ok) d = await r.json(); } catch (e) { /* silent */ }
    if (!d || d.staked == null) {
      $("c-cb").textContent = "0";
      $("c-cb-s").textContent = "starting: no Cardboard data yet";
      return;
    }
    $("c-cb").innerHTML = cb(d.staked) + ' <small style="font-size:12px;font-weight:400" class="muted">CARDBOARD staked</small>';
    const parts = [
      "unstaked " + cb(d.unstaked) + " · claimable " + cb(d.claimable),
      "USDC $" + n(d.usdc_total != null ? d.usdc_total : d.usdc_available, 2) + (Number(d.margin_in_use) ? " ($" + n(d.margin_in_use, 2) + " in margin)" : ""),
      (Number(d.open_positions) || 0) + " open position" + (Number(d.open_positions) === 1 ? "" : "s"),
      "staking rewards $" + n(d.rewards_pending_usdc, 2) + " claimable · $" + n(d.rewards_claimed_usdc, 2) + " claimed",
    ];
    if (d.status === "starting") parts.unshift("starting");
    if (d.farm_status && d.farm_status !== "running") parts.push("farm: " + String(d.farm_status).replace(/_/g, " "));
    parts.push("updated " + (d.generated_ts ? et(d.generated_ts) : "-"));
    $("c-cb-s").textContent = parts.join(" · ");
    $("c-cb-s").title = "Source: " + (d.source || "?") + " · burner " + (d.owner || "");
  }
  load();
  setInterval(load, 60000);
  const b = $("refresh"); if (b) b.addEventListener("click", load);
})();
