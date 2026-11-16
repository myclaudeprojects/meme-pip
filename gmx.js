// GMX tab: shows Arbitrum balances and open GMX perps from live.json.
// Rendering stays in app.js (renderGmx). This file only switches the tab.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const view = $("view-gmx");
  if (!view) return;
  const OTHERS = ["view-main", "view-bskt", "view-btc15", "view-series7"];

  function setHash(on) {
    try {
      if (on) {
        if (location.hash !== "#gmx") history.replaceState(null, "", "#gmx");
      } else if (location.hash === "#gmx") {
        history.replaceState(null, "", location.pathname + location.search);
      }
    } catch (err) { /* the tab still works if the history API is blocked */ }
  }

  function activate() {
    view.hidden = false;
    OTHERS.forEach((id) => { const el = $(id); if (el) el.hidden = true; });
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === "gmx"));
    setHash(true);
  }

  function deactivate() {
    view.hidden = true;
    setHash(false);
  }

  document.querySelectorAll("[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.view === "gmx") activate();
      else deactivate();
    });
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#gmx") activate();
    else deactivate();
  });
  if (location.hash === "#gmx") activate();
})();
