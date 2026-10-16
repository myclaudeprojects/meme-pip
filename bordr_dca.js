(function(){const f=n=>n==null?"-":Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const sec=document.createElement("section");sec.id="bordr-dca";sec.innerHTML='<h2>BORDR DCA <small id="dca-upd"></small></h2><div id="dca-body" class="muted">Loading…</div>';
const m=document.getElementById("view-main");m&&m.insertBefore(sec,m.firstChild);
async function load(){try{const s=await (await fetch("bordr_dca.json?"+Date.now())).json();
document.getElementById("dca-upd").textContent="updated "+(s.updated_et||"-")+" · "+s.status;
const pnl=s.dca_pnl_usd;const rows=(s.buys||[]).slice().reverse().map(b=>`<tr><td class="l">${b.n}</td><td class="l">${b.t_et}</td><td>${f(b.sol)} SOL</td><td>$${f(b.usd)}</td><td>${f(b.bordr)}</td><td>$${f(b.fill_mc)}</td><td class="l"><a target="_blank" href="https://solscan.io/tx/${b.sig}">tx</a></td></tr>`).join("");
document.getElementById("dca-body").innerHTML=`<div class="grid">
<div class="card"><div class="k">Buys</div><div class="v">${s.buys_done||0} / ${s.planned??"-"}</div><div class="s">$250 every 2 min</div></div>
<div class="card"><div class="k">Total in</div><div class="v">$${f(s.total_usd_in)}</div><div class="s">${f(s.total_sol_in)} SOL</div></div>
<div class="card"><div class="k">BORDR held</div><div class="v">${f(s.bordr_held)}</div><div class="s">DCA bought ${f(s.bordr_bought)}</div></div>
<div class="card"><div class="k">Avg entry MC → now</div><div class="v">$${f(s.avg_entry_mc)} → $${f(s.current_mc)}</div><div class="s" style="color:${pnl>=0?"#3c3":"#e55"}">DCA PnL $${f(pnl)}</div></div>
<div class="card"><div class="k">SOL left</div><div class="v">${f(s.sol_left)}</div><div class="s">floor ${s.sol_floor} SOL · ${s.last_tx?`<a target="_blank" href="${s.last_tx}">last tx</a>`:""}</div></div></div>
<div class="wrap"><table><thead><tr><th class="l">#</th><th class="l">Time ET</th><th>SOL</th><th>USD</th><th>BORDR</th><th>Fill MC</th><th class="l">Tx</th></tr></thead><tbody>${rows}</tbody></table></div>`;}catch(e){}}
load();setInterval(load,30000);})();
