/* Series 7 tab. Five-box review. Progress stays in this browser. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Series7 = api;
  if (typeof document !== "undefined" && document.getElementById && document.getElementById("view-series7")) {
    api.mount(document);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORAGE_KEY = "series7.leitner.v1";
  var DECK_URL = "series7/series7_cards.json";
  var INTERVAL_DAYS = Object.freeze({ 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });
  var BOXES = Object.freeze([1, 2, 3, 4, 5]);
  var MAX_TEXT = 8000;
  var MAX_BACKUP = 1000000;

  function localDay(date, timeZone) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    var parts = fmt.formatToParts(date || new Date());
    var pick = function (type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
      return "";
    };
    return pick("year") + "-" + pick("month") + "-" + pick("day");
  }

  function validDay(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var bits = value.split("-");
    var y = +bits[0], m = +bits[1], d = +bits[2];
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function addCalendarDays(isoDay, n) {
    if (!validDay(isoDay) || !Number.isInteger(n)) throw new Error("Invalid review date");
    var bits = isoDay.split("-");
    var dt = new Date(Date.UTC(+bits[0], +bits[1] - 1, +bits[2] + n));
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    var d = String(dt.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function validId(id) {
    return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(id);
  }

  function validBox(box) {
    return Number.isInteger(box) && box >= 1 && box <= 5;
  }

  function validateCard(card) {
    if (!card || typeof card !== "object" || Array.isArray(card)) return false;
    if (!validId(card.id)) return false;
    if (!Number.isInteger(card.chapter) || card.chapter < 0 || card.chapter > 999) return false;
    if (card.type !== "term" && card.type !== "concept") return false;
    if (typeof card.front !== "string" || !card.front.trim() || card.front.length > MAX_TEXT) return false;
    if (typeof card.back !== "string" || !card.back.trim() || card.back.length > MAX_TEXT) return false;
    return true;
  }

  function copyCard(card) {
    return { id: card.id, chapter: card.chapter, type: card.type, front: card.front, back: card.back };
  }

  function parseDeck(data) {
    if (!Array.isArray(data)) return { cards: [], skipped: 0, error: "The card list was not a list of cards." };
    var cards = [];
    var seen = Object.create(null);
    var skipped = 0;
    for (var i = 0; i < data.length; i++) {
      var raw = data[i];
      if (!validateCard(raw) || seen[raw.id]) { skipped++; continue; }
      seen[raw.id] = true;
      cards.push(copyCard(raw));
    }
    return { cards: cards, skipped: skipped, error: null };
  }

  function emptyState() {
    return { v: 1, progress: Object.create(null), custom: [] };
  }

  function sanitizeState(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 1) return null;
    var keys = Object.keys(raw);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k] !== "v" && keys[k] !== "progress" && keys[k] !== "custom") return null;
    }
    if (raw.progress != null && (typeof raw.progress !== "object" || Array.isArray(raw.progress))) return null;
    if (raw.custom != null && !Array.isArray(raw.custom)) return null;
    var progress = Object.create(null);
    var source = raw.progress || {};
    var ids = Object.keys(source);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = source[id];
      if (!validId(id) || !entry || !validBox(entry.box) || !validDay(entry.due)) return null;
      progress[id] = { box: entry.box, due: entry.due };
    }
    var custom = [];
    var list = raw.custom || [];
    for (var j = 0; j < list.length; j++) {
      if (!validateCard(list[j])) return null;
      custom.push(copyCard(list[j]));
    }
    return { v: 1, progress: progress, custom: custom };
  }

  function serialize(state) {
    var progress = {};
    Object.keys(state.progress).sort().forEach(function (id) { progress[id] = state.progress[id]; });
    return JSON.stringify({ v: 1, progress: progress, custom: state.custom }, null, 2);
  }

  function loadState(storage) {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw == null || raw === "") return { ok: true, state: emptyState(), corrupt: false, raw: null };
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch (err) { return { ok: false, state: emptyState(), corrupt: true, raw: raw }; }
      var clean = sanitizeState(parsed);
      if (!clean) return { ok: false, state: emptyState(), corrupt: true, raw: raw };
      return { ok: true, state: clean, corrupt: false, raw: null };
    } catch (err) {
      return { ok: false, state: emptyState(), corrupt: false, blocked: true, raw: null };
    }
  }

  function saveState(storage, state, opts) {
    var force = !!(opts && opts.force);
    var corrupt = !!(opts && opts.corrupt);
    if (corrupt && !force) return { ok: false, skipped: true };
    try {
      storage.setItem(STORAGE_KEY, serialize(state));
      return { ok: true };
    } catch (err) {
      return { ok: false, blocked: true };
    }
  }

  function isDue(due, today) {
    return validDay(due) && validDay(today) && due <= today;
  }

  function applyAnswer(entry, correct, today) {
    var from = entry && validBox(entry.box) ? entry.box : 1;
    var box = correct ? Math.min(5, from + 1) : 1;
    return { box: box, due: addCalendarDays(today, INTERVAL_DAYS[box]) };
  }

  function withProgress(raw, state, today, custom) {
    var entry = state.progress[raw.id];
    var fresh = !entry;
    var box = fresh ? 1 : entry.box;
    var due = fresh ? today : entry.due;
    return {
      id: raw.id,
      chapter: raw.chapter,
      type: raw.type,
      front: raw.front,
      back: raw.back,
      custom: !!custom,
      box: box,
      due: due,
      fresh: fresh,
      isDue: fresh ? true : isDue(due, today),
    };
  }

  function buildCards(deck, state, today) {
    var out = [];
    var seen = Object.create(null);
    (deck || []).forEach(function (raw) {
      if (!raw || seen[raw.id]) return;
      seen[raw.id] = true;
      out.push(withProgress(raw, state, today, false));
    });
    (state.custom || []).forEach(function (raw) {
      if (!validateCard(raw) || seen[raw.id]) return;
      seen[raw.id] = true;
      out.push(withProgress(raw, state, today, true));
    });
    return out;
  }

  function filterCards(cards, chapter) {
    if (chapter == null || chapter === "" || chapter === "all") return cards.slice();
    var n = Number(chapter);
    return cards.filter(function (card) { return card.chapter === n; });
  }

  function compareCards(a, b) {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    var ta = a.type === "term" ? 0 : 1;
    var tb = b.type === "term" ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  function dueQueue(cards) {
    return cards.filter(function (card) { return card.isDue; }).sort(compareCards);
  }

  function boxStats(cards) {
    var stats = {};
    BOXES.forEach(function (box) { stats[box] = { total: 0, due: 0 }; });
    cards.forEach(function (card) {
      if (!stats[card.box]) return;
      stats[card.box].total++;
      if (card.isDue) stats[card.box].due++;
    });
    return stats;
  }

  function nextDueDay(cards) {
    var best = null;
    cards.forEach(function (card) {
      if (card.isDue || !validDay(card.due)) return;
      if (!best || card.due < best) best = card.due;
    });
    return best;
  }

  function chaptersOf(cards) {
    var seen = Object.create(null);
    var list = [];
    cards.forEach(function (card) {
      if (seen[card.chapter]) return;
      seen[card.chapter] = true;
      list.push(card.chapter);
    });
    list.sort(function (a, b) { return a - b; });
    return list;
  }

  function cloneState(state) {
    var progress = Object.create(null);
    Object.keys(state.progress).forEach(function (id) {
      progress[id] = { box: state.progress[id].box, due: state.progress[id].due };
    });
    return { v: 1, progress: progress, custom: state.custom.map(copyCard) };
  }

  function answerCard(state, id, correct, today) {
    if (!validId(id)) return { ok: false, state: state, error: "That card could not be updated." };
    var current = state.progress[id] || { box: 1, due: today };
    var next = applyAnswer(current, !!correct, today);
    var copy = cloneState(state);
    copy.progress[id] = next;
    return { ok: true, state: copy, entry: next };
  }

  function resolveReset(state, choice) {
    if (choice !== "confirm") return { ok: true, state: state, changed: false };
    return { ok: true, state: { v: 1, progress: Object.create(null), custom: state.custom.map(copyCard) }, changed: true };
  }

  function resolveImport(state, incoming, choice) {
    var clean = sanitizeState(incoming);
    if (!clean) return { ok: false, state: state, error: "That file isn't a Series 7 backup." };
    if (choice !== "confirm") return { ok: true, state: state, changed: false };
    return { ok: true, state: clean, changed: true };
  }

  function addCustomCard(state, input, today, reservedIds) {
    var front = input && typeof input.front === "string" ? input.front.trim() : "";
    var back = input && typeof input.back === "string" ? input.back.trim() : "";
    var chapterText = input && input.chapter != null ? String(input.chapter).trim() : "";
    if (!front || !back) return { ok: false, state: state, error: "Enter a front and a back." };
    if (!/^\d+$/.test(chapterText) || Number(chapterText) > 999) return { ok: false, state: state, error: "Enter a chapter number." };
    var chapter = Number(chapterText);
    var kind = input.type === "concept" ? "concept" : input.type === "term" ? "term" : "";
    if (!kind) return { ok: false, state: state, error: "Choose term or concept." };
    var taken = reservedIds || [];
    var id = input.id;
    if (!id) {
      var guard = 0;
      do {
        id = "custom-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 2176782336).toString(36);
        guard++;
      } while ((taken.indexOf(id) !== -1 || state.progress[id] || state.custom.some(function (card) { return card.id === id; })) && guard < 8);
    }
    var card = { id: id, chapter: chapter, type: kind, front: front, back: back };
    if (!validateCard(card)) return { ok: false, state: state, error: "That card could not be added." };
    if (taken.indexOf(card.id) !== -1 || state.custom.some(function (existing) { return existing.id === card.id; })) {
      return { ok: false, state: state, error: "That card id already exists." };
    }
    var copy = cloneState(state);
    copy.custom.push(card);
    copy.progress[card.id] = { box: 1, due: today };
    return { ok: true, state: copy, card: card };
  }

  function formatDay(iso) {
    if (!validDay(iso)) return "";
    var bits = iso.split("-");
    return new Date(+bits[0], +bits[1] - 1, +bits[2]).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  function typeLabel(type) { return type === "concept" ? "Concept" : "Term"; }

  function mount(doc, opts) {
    opts = opts || {};
    var view = doc.getElementById("view-series7");
    if (!view || view.dataset.wired === "1") return { ready: function () { return Promise.resolve(); } };
    view.dataset.wired = "1";
    var win = doc.defaultView || root;
    var loc = win.location;
    var now = opts.now || function () { return new Date(); };
    var zone = opts.timeZone;
    var fetchImpl = opts.fetch || win.fetch.bind(win);
    var storage = opts.storage;
    if (!storage) {
      try { storage = win.localStorage; }
      catch (err) { storage = null; }
    }
    if (!storage) {
      storage = {
        getItem: function () { throw new Error("storage blocked"); },
        setItem: function () { throw new Error("storage blocked"); },
      };
    }

    var $ = function (id) { return doc.getElementById(id); };
    var loaded = loadState(storage);
    var ui = {
      deck: [],
      skipped: 0,
      loaded: false,
      loadError: null,
      state: loaded.state,
      corrupt: !!loaded.corrupt,
      blocked: !!loaded.blocked,
      raw: loaded.raw,
      persistNote: "",
      chapter: "all",
      chapterKey: "",
      flipped: false,
      currentId: null,
      pendingImport: null,
    };
    var deckPromise = null;

    function today() { return localDay(now(), zone); }

    function setPersistNote() {
      var el = $("s7-persist");
      var rawBtn = $("s7-download-raw");
      if (!el) return;
      var text = "";
      if (ui.blocked) text = "This browser blocked saving progress. You can keep reviewing on this page and export a backup. A refresh may lose what you just did.";
      else if (ui.corrupt) text = "Saved progress in this browser could not be read, so it was left as-is. Download that unreadable backup, or reset progress to start over.";
      else if (ui.persistNote) text = ui.persistNote;
      el.hidden = !text;
      el.textContent = text;
      if (rawBtn) rawBtn.hidden = !ui.raw;
    }

    function rememberSave(result, force) {
      if (result && result.ok) {
        ui.corrupt = false;
        ui.blocked = false;
        ui.raw = null;
        ui.persistNote = "";
        return;
      }
      if (result && result.skipped && !force) return;
      if (!ui.corrupt) ui.blocked = true;
      ui.persistNote = "Progress could not be saved in this browser. You can keep reviewing, and you can export a backup. A refresh may lose what you just did.";
    }

    function persist(force) {
      var result = saveState(storage, ui.state, { force: !!force, corrupt: ui.corrupt });
      rememberSave(result, force);
      setPersistNote();
      return result;
    }

    function setHash(on) {
      try {
        if (on) {
          if (loc.hash !== "#series7") win.history.replaceState(null, "", "#series7");
        } else if (loc.hash === "#series7") {
          win.history.replaceState(null, "", loc.pathname + loc.search);
        }
      } catch (err) { /* the tab still works if the history API is blocked */ }
    }

    function activate() {
      view.hidden = false;
      ["view-main", "view-bskt", "view-btc15"].forEach(function (id) {
        var el = $(id);
        if (el) el.hidden = true;
      });
      doc.querySelectorAll("[data-view]").forEach(function (button) {
        button.classList.toggle("on", button.dataset.view === "series7");
      });
      setHash(true);
      if (!ui.loaded && !ui.loadError) {
        var status = $("s7-status");
        if (status) status.textContent = "Loading the card list…";
      } else render();
      ensureDeck(false).then(function () { if (!view.hidden) render(); });
    }

    function deactivate() {
      view.hidden = true;
      setHash(false);
    }

    function ensureDeck(force) {
      if (force) deckPromise = null;
      if (deckPromise) return deckPromise;
      deckPromise = Promise.resolve()
        .then(function () { return fetchImpl(DECK_URL, { cache: "no-store" }); })
        .then(function (res) {
          if (!res || !res.ok) throw new Error("error " + ((res && res.status) || "unavailable"));
          return Promise.resolve(res.json()).catch(function () { throw new Error("the file was not valid JSON"); });
        })
        .then(function (data) {
          var parsed = parseDeck(data);
          if (parsed.error) throw new Error(parsed.error);
          ui.deck = parsed.cards;
          ui.skipped = parsed.skipped;
          ui.loadError = null;
          ui.loaded = true;
        })
        .catch(function (err) {
          var note = "The card list could not be loaded (" + (err && err.message ? err.message : "network error") + ").";
          if (ui.loaded) ui.persistNote = "The card list could not be refreshed. Showing the cards already loaded.";
          else ui.loadError = note;
          deckPromise = ui.loaded ? Promise.resolve() : null;
        });
      return deckPromise;
    }

    function renderBoxes(stats, currentBox) {
      var host = $("s7-boxes");
      if (!host) return;
      host.replaceChildren();
      BOXES.forEach(function (box) {
        var el = doc.createElement("div");
        el.className = "s7-box" + (currentBox === box ? " on" : "");
        el.dataset.box = String(box);
        var k = doc.createElement("div");
        k.className = "k";
        k.textContent = "Box " + box;
        var n = doc.createElement("div");
        n.className = "v";
        n.textContent = String(stats[box].total);
        var s = doc.createElement("div");
        s.className = "s";
        s.textContent = stats[box].due + " due";
        el.append(k, n, s);
        host.append(el);
      });
    }

    function renderChapters(cards) {
      var select = $("s7-chapter");
      if (!select) return;
      var chapters = chaptersOf(cards);
      var key = chapters.join(",");
      if (key === ui.chapterKey) { select.value = ui.chapter; return; }
      ui.chapterKey = key;
      select.replaceChildren();
      var all = doc.createElement("option");
      all.value = "all";
      all.textContent = "All chapters";
      select.append(all);
      chapters.forEach(function (chapter) {
        var option = doc.createElement("option");
        option.value = String(chapter);
        option.textContent = "Chapter " + chapter;
        select.append(option);
      });
      if (ui.chapter !== "all" && chapters.indexOf(Number(ui.chapter)) === -1) ui.chapter = "all";
      select.value = ui.chapter;
    }

    function render() {
      setPersistNote();
      var day = today();
      var cards = buildCards(ui.deck, ui.state, day);
      renderChapters(cards);
      var filtered = filterCards(cards, ui.chapter);
      var stats = boxStats(filtered);
      var queue = dueQueue(filtered);
      var current = null;
      if (ui.currentId) current = queue.filter(function (card) { return card.id === ui.currentId; })[0] || null;
      if (!current) {
        current = queue[0] || null;
        ui.currentId = current ? current.id : null;
        ui.flipped = false;
      }
      renderBoxes(stats, current ? current.box : null);
      var dueEl = $("s7-due");
      if (dueEl) {
        var noun = queue.length === 1 ? "card" : "cards";
        dueEl.textContent = queue.length + " " + noun + " due today";
      }
      var status = $("s7-status");
      var meta = $("s7-meta");
      var front = $("s7-front");
      var back = $("s7-back");
      var flip = $("s7-flip");
      var got = $("s7-got");
      var miss = $("s7-miss");
      var retry = $("s7-retry");
      var message = "";
      if (ui.loadError && !ui.loaded) message = ui.loadError;
      else if (!ui.loaded) message = "Loading the card list…";
      else if (!cards.length && ui.skipped) message = "The card list didn't include any usable cards.";
      else if (!cards.length) message = "No cards are available.";
      else if (!filtered.length) message = "No cards in this chapter.";
      else if (!current) {
        var next = nextDueDay(filtered);
        message = next ? "Nothing is due today. Next review is " + formatDay(next) + "." : "Nothing is due today.";
      }
      if (status) status.textContent = message;
      if (ui.loaded && ui.skipped && !message) {
        if (status) status.textContent = "Skipped " + ui.skipped + (ui.skipped === 1 ? " unreadable card." : " unreadable cards.");
      }
      if (meta) meta.textContent = current ? "Chapter " + current.chapter + " · " + typeLabel(current.type) + " · Box " + current.box : "";
      if (front) front.textContent = current ? current.front : "";
      if (back) {
        back.textContent = current && ui.flipped ? current.back : "";
        back.hidden = !(current && ui.flipped);
      }
      var showFlip = !!(current && !ui.flipped);
      if (flip) flip.hidden = !showFlip;
      if (got) got.hidden = !(current && ui.flipped);
      if (miss) miss.hidden = !(current && ui.flipped);
      if (retry) retry.hidden = !(ui.loadError && !ui.loaded);
    }

    function answer(correct) {
      if (!ui.flipped || !ui.currentId) return;
      var result = answerCard(ui.state, ui.currentId, correct, today());
      if (!result.ok) return;
      ui.state = result.state;
      ui.currentId = null;
      ui.flipped = false;
      persist(false);
      render();
    }

    doc.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.dataset.view === "series7") activate();
        else deactivate();
      });
    });
    win.addEventListener("hashchange", function () {
      if (loc.hash === "#series7") activate();
      else deactivate();
    });

    var chapter = $("s7-chapter");
    if (chapter) chapter.addEventListener("change", function () {
      ui.chapter = chapter.value || "all";
      ui.currentId = null;
      ui.flipped = false;
      render();
    });
    var flipBtn = $("s7-flip");
    if (flipBtn) flipBtn.addEventListener("click", function () {
      if (!ui.currentId) return;
      ui.flipped = true;
      render();
    });
    var frontEl = $("s7-front");
    if (frontEl) frontEl.addEventListener("click", function () {
      if (!ui.currentId || ui.flipped) return;
      ui.flipped = true;
      render();
    });
    var gotBtn = $("s7-got");
    if (gotBtn) gotBtn.addEventListener("click", function () { answer(true); });
    var missBtn = $("s7-miss");
    if (missBtn) missBtn.addEventListener("click", function () { answer(false); });
    var retryBtn = $("s7-retry");
    if (retryBtn) retryBtn.addEventListener("click", function () {
      ui.loadError = null;
      ensureDeck(true).then(function () { render(); });
    });

    var addForm = $("s7-add");
    if (addForm) addForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var msg = $("s7-add-msg");
      var reserved = ui.deck.map(function (card) { return card.id; });
      var result = addCustomCard(ui.state, {
        front: $("s7-add-front") ? $("s7-add-front").value : "",
        back: $("s7-add-back") ? $("s7-add-back").value : "",
        chapter: $("s7-add-chapter") ? $("s7-add-chapter").value : "",
        type: $("s7-add-type") ? $("s7-add-type").value : "",
      }, today(), reserved);
      if (!result.ok) {
        if (msg) msg.textContent = result.error;
        return;
      }
      ui.state = result.state;
      ui.currentId = result.card.id;
      ui.flipped = false;
      if (ui.chapter !== "all" && Number(ui.chapter) !== result.card.chapter) ui.chapter = "all";
      persist(false);
      addForm.reset();
      if (msg) msg.textContent = "Added to box 1. It is due today.";
      render();
    });

    function download(filename, text, mime) {
      if (opts.onExport) { opts.onExport(filename, text); return; }
      var blob = new win.Blob([text], { type: mime || "application/json" });
      var url = win.URL.createObjectURL(blob);
      var link = doc.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener";
      doc.body.appendChild(link);
      link.click();
      link.remove();
      win.URL.revokeObjectURL(url);
    }

    var exportBtn = $("s7-export");
    if (exportBtn) exportBtn.addEventListener("click", function () {
      download("series7-progress.json", serialize(ui.state));
      var msg = $("s7-io-msg");
      if (msg) msg.textContent = "Backup downloaded. Keep that file if you want this progress on another browser.";
    });
    var rawBtn = $("s7-download-raw");
    if (rawBtn) rawBtn.addEventListener("click", function () {
      if (ui.raw) download("series7-progress-unreadable.txt", ui.raw, "text/plain");
    });

    function closeImport() {
      ui.pendingImport = null;
      var panel = $("s7-import-confirm");
      if (panel) panel.hidden = true;
      var input = $("s7-import");
      if (input) input.value = "";
    }

    var importInput = $("s7-import");
    if (importInput) importInput.addEventListener("change", function () {
      var file = importInput.files && importInput.files[0];
      var msg = $("s7-io-msg");
      if (!file) return;
      if (file.size > MAX_BACKUP) {
        if (msg) msg.textContent = "That backup is too large.";
        importInput.value = "";
        return;
      }
      var reader = new win.FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (err) {
          if (msg) msg.textContent = "That file isn't a Series 7 backup.";
          importInput.value = "";
          return;
        }
        var check = resolveImport(ui.state, parsed, "cancel");
        if (!check.ok) {
          if (msg) msg.textContent = check.error;
          importInput.value = "";
          return;
        }
        ui.pendingImport = parsed;
        var panel = $("s7-import-confirm");
        if (panel) panel.hidden = false;
        var resetPanel = $("s7-reset-confirm");
        if (resetPanel) resetPanel.hidden = true;
        if (msg) msg.textContent = "";
      };
      reader.onerror = function () {
        if (msg) msg.textContent = "That backup could not be read.";
      };
      reader.readAsText(file);
    });
    var importCancel = $("s7-import-cancel");
    if (importCancel) importCancel.addEventListener("click", function () {
      closeImport();
      var msg = $("s7-io-msg");
      if (msg) msg.textContent = "Import cancelled. Progress was not changed.";
    });
    var importGo = $("s7-import-go");
    if (importGo) importGo.addEventListener("click", function () {
      var msg = $("s7-io-msg");
      if (!ui.pendingImport) return;
      var result = resolveImport(ui.state, ui.pendingImport, "confirm");
      if (!result.ok || !result.changed) {
        if (msg) msg.textContent = result.error || "Import cancelled. Progress was not changed.";
        closeImport();
        return;
      }
      ui.state = result.state;
      ui.currentId = null;
      ui.flipped = false;
      ui.corrupt = false;
      ui.raw = null;
      closeImport();
      persist(true);
      if (msg) msg.textContent = "Backup restored in this browser.";
      render();
    });

    var resetBtn = $("s7-reset");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      var panel = $("s7-reset-confirm");
      if (panel) panel.hidden = false;
      closeImport();
    });
    var resetCancel = $("s7-reset-cancel");
    if (resetCancel) resetCancel.addEventListener("click", function () {
      var panel = $("s7-reset-confirm");
      if (panel) panel.hidden = true;
    });
    var resetGo = $("s7-reset-go");
    if (resetGo) resetGo.addEventListener("click", function () {
      var result = resolveReset(ui.state, "confirm");
      ui.state = result.state;
      ui.currentId = null;
      ui.flipped = false;
      ui.corrupt = false;
      ui.raw = null;
      var panel = $("s7-reset-confirm");
      if (panel) panel.hidden = true;
      persist(true);
      render();
    });

    setPersistNote();
    if (loc.hash === "#series7") activate();
    return { ready: function () { return deckPromise || Promise.resolve(); } };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DECK_URL: DECK_URL,
    INTERVAL_DAYS: INTERVAL_DAYS,
    BOXES: BOXES,
    localDay: localDay,
    validDay: validDay,
    addCalendarDays: addCalendarDays,
    validateCard: validateCard,
    parseDeck: parseDeck,
    emptyState: emptyState,
    sanitizeState: sanitizeState,
    serialize: serialize,
    loadState: loadState,
    saveState: saveState,
    isDue: isDue,
    applyAnswer: applyAnswer,
    buildCards: buildCards,
    filterCards: filterCards,
    dueQueue: dueQueue,
    boxStats: boxStats,
    nextDueDay: nextDueDay,
    answerCard: answerCard,
    resolveReset: resolveReset,
    resolveImport: resolveImport,
    addCustomCard: addCustomCard,
    formatDay: formatDay,
    mount: mount,
  };
});
