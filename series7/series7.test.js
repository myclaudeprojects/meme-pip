"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const S = require("./series7.js");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "series7.js"), "utf8");
const TODAY = "2026-11-06";
const NOW = () => new Date("2026-11-07T03:30:00.000Z");
const ZONE = "America/New_York";

function card(id, chapter, front, extra) {
  return Object.assign({
    id: id,
    chapter: chapter,
    type: "term",
    front: front || id,
    back: "Back for " + id,
  }, extra || {});
}

function memory(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    data: data,
  };
}

function waitFor(fn, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let value;
      try { value = fn(); }
      catch (err) { reject(err); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - start > 2000) { reject(new Error("timed out: " + (label || "condition"))); return; }
      setTimeout(tick, 15);
    };
    tick();
  });
}

function deckFetch(deck, calls) {
  return function (url) {
    if (calls) calls.push(String(url));
    const target = String(url);
    if (target.indexOf("series7/series7_cards.json") !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(deck) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}

function mountPage(t, options) {
  const dom = new JSDOM(html, {
    url: options.url || ("https://s7-" + Math.random().toString(36).slice(2) + ".test/"),
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const fetch = options.fetch || deckFetch(options.deck || []);
  if (options.storageSeed) dom.window.localStorage.setItem(S.STORAGE_KEY, options.storageSeed);
  const handle = S.mount(dom.window.document, {
    fetch: fetch,
    now: options.now || NOW,
    timeZone: options.timeZone || ZONE,
    storage: options.storage,
    onExport: options.onExport,
  });
  return { dom: dom, win: dom.window, doc: dom.window.document, handle: handle };
}

async function openStudy(page) {
  page.doc.getElementById("s7tab").click();
  await page.handle.ready();
  await waitFor(() => {
    const status = page.doc.getElementById("s7-status").textContent;
    const front = page.doc.getElementById("s7-front").textContent;
    if (status.indexOf("Loading") !== -1) return false;
    return !!(front || status);
  }, "study view");
  return page;
}

test("local days are calendar days in the chosen timezone", () => {
  assert.equal(S.localDay(NOW(), ZONE), TODAY);
  assert.equal(S.localDay(NOW(), "UTC"), "2026-11-07");
  assert.equal(S.localDay(new Date("2026-11-06T14:00:00.000Z"), "Pacific/Auckland"), "2026-11-07");
  assert.equal(S.localDay(new Date("2026-11-06T14:00:00.000Z"), "UTC"), "2026-11-06");
  assert.doesNotMatch(script, /toISOString\s*\(/);
});

test("review intervals and box moves", () => {
  assert.deepEqual(S.INTERVAL_DAYS, { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });
  const fresh = S.buildCards([card("a", 3)], S.emptyState(), TODAY)[0];
  assert.equal(fresh.box, 1);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.isDue, true);

  const steps = [
    [{ box: 1 }, true, 2, 3],
    [{ box: 2 }, true, 3, 7],
    [{ box: 3 }, true, 4, 14],
    [{ box: 4 }, true, 5, 30],
    [{ box: 5 }, true, 5, 30],
    [{ box: 5 }, false, 1, 1],
    [{ box: 4 }, false, 1, 1],
    [{ box: 1 }, false, 1, 1],
  ];
  steps.forEach((row) => {
    const next = S.applyAnswer(row[0], row[1], TODAY);
    assert.equal(next.box, row[2], JSON.stringify(row));
    assert.equal(next.due, S.addCalendarDays(TODAY, row[3]));
    assert.equal(S.isDue(next.due, TODAY), false);
  });

  assert.equal(S.addCalendarDays("2026-11-30", 3), "2026-12-03");
  assert.equal(S.addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(S.addCalendarDays("2025-02-28", 1), "2025-03-01");
  assert.equal(S.addCalendarDays("2026-12-20", 30), "2027-01-19");
  assert.throws(() => S.addCalendarDays("2026-02-31", 1));

  const correct = S.answerCard(S.emptyState(), "a", true, TODAY);
  assert.deepEqual(correct.entry, { box: 2, due: "2026-11-09" });
  const missed = S.answerCard(correct.state, "a", false, "2026-11-09");
  assert.deepEqual(missed.entry, { box: 1, due: "2026-11-10" });
  const shown = S.buildCards([card("a", 3)], correct.state, TODAY);
  assert.equal(shown[0].isDue, false);
  assert.equal(S.dueQueue(shown).length, 0);
  assert.equal(S.buildCards([card("a", 3)], correct.state, "2026-11-09")[0].isDue, true);
});

test("new dataset ids keep saved progress and new ids start due", () => {
  const state = {
    v: 1,
    progress: {
      keep: { box: 4, due: "2026-12-01" },
      gone: { box: 3, due: "2026-11-01" },
    },
    custom: [],
  };
  const deck = [card("keep", 3, "Updated front"), card("fresh", 9, "Brand new")];
  const cards = S.buildCards(deck, state, TODAY);
  const keep = cards.find((item) => item.id === "keep");
  const fresh = cards.find((item) => item.id === "fresh");
  assert.equal(keep.front, "Updated front");
  assert.equal(keep.box, 4);
  assert.equal(keep.due, "2026-12-01");
  assert.equal(keep.isDue, false);
  assert.equal(fresh.box, 1);
  assert.equal(fresh.isDue, true);
  assert.equal(cards.some((item) => item.id === "gone"), false);
  assert.equal(state.progress.gone.box, 3);

  const store = memory();
  assert.equal(S.saveState(store, state).ok, true);
  const loaded = S.loadState(store);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.state.progress.keep, { box: 4, due: "2026-12-01" });
  assert.deepEqual(loaded.state.progress.gone, { box: 3, due: "2026-11-01" });
  const again = S.buildCards([card("keep", 3, "Updated front"), card("fresh", 9)], loaded.state, TODAY);
  assert.equal(again.find((item) => item.id === "keep").box, 4);
  assert.equal(again.find((item) => item.id === "fresh").isDue, true);
});

test("storage failures and other dashboard keys are left alone", () => {
  const blocked = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  };
  const failed = S.loadState(blocked);
  assert.equal(failed.ok, false);
  assert.equal(failed.blocked, true);
  assert.equal(S.saveState(blocked, S.emptyState()).ok, false);

  const corrupt = memory();
  corrupt.setItem(S.STORAGE_KEY, "{");
  const unreadable = S.loadState(corrupt);
  assert.equal(unreadable.corrupt, true);
  assert.equal(unreadable.raw, "{");
  assert.equal(S.saveState(corrupt, S.emptyState(), { corrupt: true }).skipped, true);
  assert.equal(corrupt.getItem(S.STORAGE_KEY), "{");
  assert.equal(S.saveState(corrupt, S.emptyState(), { corrupt: true, force: true }).ok, true);
  assert.notEqual(corrupt.getItem(S.STORAGE_KEY), "{");

  const isolated = memory({
    organicHolderHist: "{\"mint\":1}",
    scanSort: "newest",
    scanFirstSeen: "{\"abc\":1}",
  });
  const answered = S.answerCard(S.emptyState(), "ch3-term-01", true, TODAY);
  S.saveState(isolated, answered.state);
  assert.equal(isolated.getItem("organicHolderHist"), "{\"mint\":1}");
  assert.equal(isolated.getItem("scanSort"), "newest");
  assert.equal(isolated.getItem("scanFirstSeen"), "{\"abc\":1}");
  assert.equal(Object.keys(isolated.data).filter((key) => key !== "organicHolderHist" && key !== "scanSort" && key !== "scanFirstSeen").join(","), S.STORAGE_KEY);
  assert.equal(JSON.parse(isolated.getItem(S.STORAGE_KEY)).progress["ch3-term-01"].box, 2);
});

test("schema checks skip bad cards and reject a backup that is not a deck state", () => {
  const parsed = S.parseDeck([
    card("ok", 3, "Visible"),
    card("ok", 4, "Duplicate"),
    { id: "", chapter: 3, type: "term", front: "No", back: "Id" },
    { id: "bad-type", chapter: 3, type: "note", front: "No", back: "Type" },
    { id: "__proto__", chapter: 3, type: "term", front: "No", back: "Key" },
    { id: "html", chapter: 1, type: "concept", front: "<img src=x onerror=alert(1)>", back: "<script>alert(1)</script>" },
    { id: "blank", chapter: 1, type: "term", front: "   ", back: "No" },
  ]);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.cards.map((item) => item.id), ["ok", "html"]);
  assert.equal(parsed.skipped, 5);
  assert.equal(S.parseDeck({ cards: [] }).error, "The card list was not a list of cards.");

  const incoming = { nope: true };
  const rejected = S.resolveImport(S.emptyState(), incoming, "confirm");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.custom.length, 0);
});

test("chapter filter, reset cancellation, and custom cards", () => {
  const deck = [card("a", 3, "Three"), card("b", 9, "Nine", { type: "concept" }), card("c", 3, "Also")];
  const cards = S.buildCards(deck, S.emptyState(), TODAY);
  assert.deepEqual(S.filterCards(cards, 9).map((item) => item.id), ["b"]);
  assert.deepEqual(S.filterCards(cards, "all").map((item) => item.id), ["a", "b", "c"]);
  assert.equal(S.boxStats(S.filterCards(cards, 3))[1].total, 2);
  assert.equal(S.boxStats(S.filterCards(cards, 3))[1].due, 2);
  assert.equal(S.boxStats(cards)[2].total, 0);
  assert.deepEqual(S.dueQueue(cards).map((item) => item.id), ["a", "c", "b"]);

  const state = S.answerCard(S.emptyState(), "a", true, TODAY).state;
  assert.equal(S.resolveReset(state, "cancel").changed, false);
  assert.equal(S.resolveReset(state, "cancel").state, state);
  const wiped = S.resolveReset(state, "confirm");
  assert.equal(wiped.changed, true);
  assert.deepEqual(Object.keys(wiped.state.progress), []);
  assert.equal(S.buildCards(deck, wiped.state, TODAY).every((item) => item.isDue && item.box === 1), true);

  const added = S.addCustomCard(S.emptyState(), { front: " My term ", back: " Meaning ", chapter: "8", type: "term" }, TODAY, ["a"]);
  assert.equal(added.ok, true);
  assert.equal(added.card.front, "My term");
  assert.equal(added.state.progress[added.card.id].box, 1);
  assert.equal(added.state.progress[added.card.id].due, TODAY);
  assert.equal(S.buildCards(deck, added.state, TODAY).some((item) => item.custom && item.isDue), true);
  assert.equal(S.addCustomCard(S.emptyState(), { front: " ", back: "x", chapter: "3", type: "term" }, TODAY, []).ok, false);
  assert.equal(S.addCustomCard(added.state, { front: "Q", back: "A", chapter: "3", type: "term", id: added.card.id }, TODAY, []).ok, false);

  const backup = JSON.parse(S.serialize(added.state));
  const cancelled = S.resolveImport(state, backup, "cancel");
  assert.equal(cancelled.changed, false);
  assert.equal(cancelled.state, state);
  const restored = S.resolveImport(state, backup, "confirm");
  assert.equal(restored.changed, true);
  assert.equal(restored.state.custom[0].front, "My term");
});

test("published deck is a separate JSON asset and the page keeps the existing tabs", () => {
  const deck = JSON.parse(fs.readFileSync(path.join(__dirname, "series7_cards.json"), "utf8"));
  const parsed = S.parseDeck(deck);
  assert.equal(parsed.error, null);
  assert.equal(parsed.skipped, 0);
  assert.ok(parsed.cards.length > 0);
  assert.equal(new Set(parsed.cards.map((item) => item.id)).size, parsed.cards.length);
  const emma = parsed.cards.find((item) => item.id === "ch3-term-01");
  assert.equal(emma.front, "EMMA");
  assert.equal(emma.chapter, 3);
  assert.equal(emma.type, "term");

  assert.equal(S.DECK_URL, "series7/series7_cards.json");
  assert.doesNotMatch(script, /EMMA/);
  assert.doesNotMatch(script, /positions\.json/);
  assert.doesNotMatch(script, /organicHolderHist/);
  assert.doesNotMatch(script, /scanSort/);
  assert.doesNotMatch(script, /scanFirstSeen/);
  assert.doesNotMatch(script, /dexscreener/);
  assert.doesNotMatch(script, /kalshi/i);
  assert.match(script, /series7\.leitner\.v1/);

  ["data-view=\"main\"", "data-view=\"bskt\"", "data-view=\"btc15\"", "id=\"b15tab\"", "id=\"view-main\"", "id=\"view-bskt\"", "id=\"view-btc15\"", "id=\"positions\"", "id=\"scan\"", "src=\"app.js?v=livemc1\"", "src=\"bskt.js\"", "src=\"core.js?v=arcfix1\"", "src=\"positions.js\"", "btc15.js?v=8", "data-view=\"series7\"", "id=\"s7tab\"", "id=\"view-series7\"", "series7/series7.js?v=1"].forEach((needle) => {
    assert.match(html, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  const btcAt = sources.findIndex((src) => src.indexOf("btc15.js") === 0);
  const seriesAt = sources.findIndex((src) => src.indexOf("series7/series7.js") === 0);
  assert.ok(btcAt >= 0 && seriesAt > btcAt);
  assert.match(fs.readFileSync(path.join(root, "btc15.js"), "utf8"), /#btc15/);
  assert.match(fs.readFileSync(path.join(__dirname, "SYNC.md"), "utf8"), /1, 3, 7, 14, or 30 days/);
});

test("study screen flips, grades, filters, and renders text safely", async (t) => {
  const calls = [];
  const page = mountPage(t, {
    deck: [
      card("safe", 3, "<img src=x onerror=alert(1)>", { back: "<script>alert(1)</script>" }),
      card("nine", 9, "Chapter nine", { type: "concept" }),
    ],
    fetch: deckFetch([
      card("safe", 3, "<img src=x onerror=alert(1)>", { back: "<script>alert(1)</script>" }),
      card("nine", 9, "Chapter nine", { type: "concept" }),
    ], calls),
  });
  await openStudy(page);
  const doc = page.doc;
  assert.equal(doc.getElementById("view-series7").hidden, false);
  assert.equal(doc.getElementById("view-main").hidden, true);
  assert.equal(doc.getElementById("s7-front").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(doc.querySelector("#s7-stage script, #s7-stage img"), null);
  assert.equal(doc.getElementById("s7-got").hidden, true);
  assert.equal(doc.getElementById("s7-flip").hidden, false);
  assert.equal(doc.querySelector("[data-box='1'] .v").textContent, "2");
  assert.equal(doc.querySelector("[data-box='1'] .s").textContent, "2 due");
  assert.equal(page.win.localStorage.getItem(S.STORAGE_KEY), null);
  assert.ok(calls.some((url) => url.indexOf("series7/series7_cards.json") !== -1));

  doc.getElementById("s7-got").click();
  assert.equal(page.win.localStorage.getItem(S.STORAGE_KEY), null);
  assert.equal(doc.getElementById("s7-front").textContent, "<img src=x onerror=alert(1)>");

  doc.getElementById("s7-flip").click();
  assert.equal(doc.getElementById("s7-back").hidden, false);
  assert.equal(doc.getElementById("s7-back").textContent, "<script>alert(1)</script>");
  assert.equal(doc.querySelector("#s7-stage script, #s7-stage img"), null);
  assert.equal(doc.getElementById("s7-got").hidden, false);

  doc.getElementById("s7-got").click();
  const saved = JSON.parse(page.win.localStorage.getItem(S.STORAGE_KEY));
  assert.deepEqual(saved.progress.safe, { box: 2, due: "2026-11-09" });
  assert.equal(doc.getElementById("s7-front").textContent, "Chapter nine");
  assert.equal(doc.querySelector("[data-box='2'] .v").textContent, "1");
  assert.equal(doc.querySelector("[data-box='2'] .s").textContent, "0 due");
  assert.equal(doc.getElementById("s7-due").textContent, "1 card due today");

  doc.getElementById("s7-chapter").value = "3";
  doc.getElementById("s7-chapter").dispatchEvent(new page.win.Event("change"));
  assert.equal(doc.getElementById("s7-front").textContent, "");
  assert.match(doc.getElementById("s7-status").textContent, /Nothing is due today/);
  assert.match(doc.getElementById("s7-status").textContent, new RegExp(S.formatDay("2026-11-09").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(doc.querySelector("[data-box='1'] .v").textContent, "0");
  assert.equal(doc.querySelector("[data-box='2'] .v").textContent, "1");

  doc.getElementById("s7-chapter").value = "9";
  doc.getElementById("s7-chapter").dispatchEvent(new page.win.Event("change"));
  assert.equal(doc.getElementById("s7-front").textContent, "Chapter nine");
  doc.getElementById("s7-flip").click();
  doc.getElementById("s7-miss").click();
  const missed = JSON.parse(page.win.localStorage.getItem(S.STORAGE_KEY));
  assert.deepEqual(missed.progress.nine, { box: 1, due: "2026-11-07" });
  assert.match(doc.getElementById("s7-status").textContent, /Nothing is due today/);
  assert.equal(S.isDue("2026-11-07", TODAY), false);
});

test("reset cancellation leaves progress, and confirm clears it", async (t) => {
  const page = mountPage(t, { deck: [card("only", 4, "Only card")] });
  await openStudy(page);
  const doc = page.doc;
  doc.getElementById("s7-flip").click();
  doc.getElementById("s7-got").click();
  const before = page.win.localStorage.getItem(S.STORAGE_KEY);
  assert.equal(JSON.parse(before).progress.only.box, 2);
  assert.equal(doc.getElementById("s7-reset-confirm").hidden, true);

  doc.getElementById("s7-reset").click();
  assert.equal(doc.getElementById("s7-reset-confirm").hidden, false);
  doc.getElementById("s7-reset-cancel").click();
  assert.equal(doc.getElementById("s7-reset-confirm").hidden, true);
  assert.equal(page.win.localStorage.getItem(S.STORAGE_KEY), before);
  assert.match(doc.getElementById("s7-status").textContent, /Nothing is due today/);

  doc.getElementById("s7-reset").click();
  doc.getElementById("s7-reset-go").click();
  assert.equal(doc.getElementById("s7-reset-confirm").hidden, true);
  assert.deepEqual(JSON.parse(page.win.localStorage.getItem(S.STORAGE_KEY)).progress, {});
  assert.equal(doc.getElementById("s7-front").textContent, "Only card");
  assert.equal(doc.querySelector("[data-box='1'] .s").textContent, "1 due");
});

test("reload keeps progress for ids that remain in a new deck file", async (t) => {
  const firstDeck = [card("keep", 3, "Original"), card("fresh", 6, "Fresh")];
  const page = mountPage(t, { deck: firstDeck });
  await openStudy(page);
  page.doc.getElementById("s7-flip").click();
  page.doc.getElementById("s7-got").click();
  const raw = page.win.localStorage.getItem(S.STORAGE_KEY);
  assert.equal(JSON.parse(raw).progress.keep.box, 2);

  const next = mountPage(t, {
    deck: [card("keep", 3, "Reworded"), card("brand-new", 8, "Added later")],
    storageSeed: raw,
  });
  await openStudy(next);
  assert.equal(next.doc.getElementById("s7-front").textContent, "Added later");
  next.doc.getElementById("s7-chapter").value = "3";
  next.doc.getElementById("s7-chapter").dispatchEvent(new next.win.Event("change"));
  assert.match(next.doc.getElementById("s7-status").textContent, /Nothing is due today/);
  assert.equal(next.doc.querySelector("[data-box='2'] .v").textContent, "1");
  const all = S.buildCards(
    [card("keep", 3, "Reworded"), card("brand-new", 8, "Added later")],
    S.loadState(memory({ [S.STORAGE_KEY]: raw })).state,
    TODAY
  );
  assert.equal(all.find((item) => item.id === "keep").front, "Reworded");
  assert.equal(all.find((item) => item.id === "keep").box, 2);
  assert.equal(all.find((item) => item.id === "brand-new").box, 1);
  assert.equal(all.find((item) => item.id === "brand-new").isDue, true);
});

test("custom cards, import cancellation, empty list, load error, and blocked storage", async (t) => {
  const exported = [];
  const page = mountPage(t, {
    deck: [card("base", 3, "Base")],
    onExport: (name, text) => exported.push({ name: name, text: text }),
  });
  await openStudy(page);
  const doc = page.doc;
  doc.getElementById("s7-add").dispatchEvent(new page.win.Event("submit", { bubbles: true, cancelable: true }));
  assert.match(doc.getElementById("s7-add-msg").textContent, /front and a back/i);
  doc.getElementById("s7-add-front").value = "Custom front";
  doc.getElementById("s7-add-back").value = "Custom back";
  doc.getElementById("s7-add-chapter").value = "5";
  doc.getElementById("s7-add-type").value = "concept";
  doc.getElementById("s7-add").dispatchEvent(new page.win.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(doc.getElementById("s7-front").textContent, "Custom front");
  assert.match(doc.getElementById("s7-meta").textContent, /Chapter 5/);
  assert.match(doc.getElementById("s7-meta").textContent, /Box 1/);

  doc.getElementById("s7-export").click();
  assert.equal(exported[0].name, "series7-progress.json");
  const backup = JSON.parse(exported[0].text);
  assert.equal(backup.custom[0].front, "Custom front");
  const before = page.win.localStorage.getItem(S.STORAGE_KEY);

  const replacement = { v: 1, progress: { base: { box: 5, due: "2026-12-20" } }, custom: [] };
  const input = doc.getElementById("s7-import");
  const file = new page.win.File([JSON.stringify(replacement)], "series7-progress.json", { type: "application/json" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new page.win.Event("change"));
  await waitFor(() => doc.getElementById("s7-import-confirm").hidden === false, "import confirm");
  doc.getElementById("s7-import-cancel").click();
  assert.equal(doc.getElementById("s7-import-confirm").hidden, true);
  assert.equal(page.win.localStorage.getItem(S.STORAGE_KEY), before);
  assert.match(doc.getElementById("s7-io-msg").textContent, /not changed/);

  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new page.win.Event("change"));
  await waitFor(() => doc.getElementById("s7-import-confirm").hidden === false, "import confirm again");
  doc.getElementById("s7-import-go").click();
  assert.deepEqual(JSON.parse(page.win.localStorage.getItem(S.STORAGE_KEY)).progress.base, { box: 5, due: "2026-12-20" });
  assert.equal(doc.getElementById("s7-front").textContent, "");
  assert.match(doc.getElementById("s7-status").textContent, /Nothing is due today/);

  const bad = new page.win.File(["[]"], "nope.json", { type: "application/json" });
  Object.defineProperty(input, "files", { configurable: true, value: [bad] });
  input.dispatchEvent(new page.win.Event("change"));
  await waitFor(() => /isn't a Series 7 backup/.test(doc.getElementById("s7-io-msg").textContent), "bad import");
  assert.equal(JSON.parse(page.win.localStorage.getItem(S.STORAGE_KEY)).progress.base.box, 5);

  const empty = mountPage(t, { deck: [] });
  await openStudy(empty);
  assert.match(empty.doc.getElementById("s7-status").textContent, /No cards are available/);

  let tries = 0;
  const flaky = mountPage(t, {
    fetch: () => {
      tries += 1;
      if (tries === 1) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => [card("back", 3, "Recovered")] });
    },
  });
  flaky.doc.getElementById("s7tab").click();
  await flaky.handle.ready();
  await waitFor(() => /could not be loaded/.test(flaky.doc.getElementById("s7-status").textContent), "load error");
  assert.equal(flaky.doc.getElementById("s7-retry").hidden, false);
  flaky.doc.getElementById("s7-retry").click();
  await flaky.handle.ready();
  await waitFor(() => flaky.doc.getElementById("s7-front").textContent === "Recovered", "retry");

  const blocked = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  };
  const blockedPage = mountPage(t, { deck: [card("mem", 3, "Memory")], storage: blocked });
  await openStudy(blockedPage);
  assert.match(blockedPage.doc.getElementById("s7-persist").textContent, /blocked saving progress/);
  blockedPage.doc.getElementById("s7-flip").click();
  blockedPage.doc.getElementById("s7-miss").click();
  assert.match(blockedPage.doc.getElementById("s7-status").textContent, /Nothing is due today/);
  assert.match(blockedPage.doc.getElementById("s7-persist").textContent, /could not be saved|blocked saving progress/);
});

test("future due date uses the local day rather than the UTC day", async (t) => {
  const seed = JSON.stringify({ v: 1, progress: { soon: { box: 2, due: "2026-11-07" } }, custom: [] });
  const page = mountPage(t, { deck: [card("soon", 3, "Tomorrow locally")], storageSeed: seed });
  await openStudy(page);
  assert.match(page.doc.getElementById("s7-status").textContent, /Nothing is due today/);
  assert.equal(page.doc.querySelector("[data-box='2'] .v").textContent, "1");
  assert.equal(page.doc.querySelector("[data-box='2'] .s").textContent, "0 due");
});

test("baseline tabs still switch and the Series 7 deep link is #series7", async (t) => {
  const deck = [card("deep", 3, "Deep link card")];
  function boot(url) {
    const dom = new JSDOM(html, { url: url, pretendToBeVisual: true, runScripts: "dangerously" });
    t.after(() => dom.window.close());
    dom.window.fetch = deckFetch(deck);
    ["bskt.js", "cardboard.js", "btc15.js", "series7/series7.js"].forEach((file) => {
      const el = dom.window.document.createElement("script");
      el.textContent = fs.readFileSync(path.join(root, file), "utf8");
      dom.window.document.body.appendChild(el);
    });
    return dom;
  }

  const linked = boot("https://organic-dashboard-np75.onrender.com/#series7");
  assert.equal(linked.window.document.getElementById("view-series7").hidden, false);
  assert.equal(linked.window.document.getElementById("view-main").hidden, true);
  assert.equal(linked.window.document.getElementById("view-btc15").hidden, true);
  assert.equal(linked.window.document.getElementById("view-bskt").hidden, true);
  assert.equal(linked.window.location.hash, "#series7");
  await waitFor(() => linked.window.document.getElementById("s7-front").textContent === "Deep link card", "deep link card");
  assert.equal(linked.window.document.getElementById("s7tab").classList.contains("on"), true);
  assert.equal(linked.window.document.getElementById("positions") != null, true);
  assert.equal(linked.window.document.getElementById("b15-left") != null, true);

  const dom = boot("https://organic-dashboard-np75.onrender.com/");
  const doc = dom.window.document;
  assert.equal(doc.getElementById("view-main").hidden, false);
  assert.equal(doc.getElementById("view-series7").hidden, true);
  assert.equal(doc.getElementById("view-btc15").hidden, true);

  doc.getElementById("b15tab").click();
  assert.equal(doc.getElementById("view-btc15").hidden, false);
  assert.equal(doc.getElementById("view-main").hidden, true);
  assert.equal(doc.getElementById("view-series7").hidden, true);
  assert.equal(dom.window.location.hash, "#btc15");
  assert.equal(doc.getElementById("b15-left") != null, true);
  assert.equal(doc.getElementById("scan") != null, true);

  doc.getElementById("s7tab").click();
  await waitFor(() => doc.getElementById("s7-front").textContent === "Deep link card", "series7 from btc");
  assert.equal(doc.getElementById("view-series7").hidden, false);
  assert.equal(doc.getElementById("view-btc15").hidden, true);
  assert.equal(doc.getElementById("view-bskt").hidden, true);
  assert.equal(doc.getElementById("view-main").hidden, true);
  assert.equal(dom.window.location.hash, "#series7");

  doc.querySelector("[data-view='main']").click();
  assert.equal(doc.getElementById("view-main").hidden, false);
  assert.equal(doc.getElementById("view-series7").hidden, true);
  assert.equal(doc.getElementById("view-btc15").hidden, true);
  assert.equal(dom.window.location.hash, "");

  doc.querySelector("[data-view='bskt']").click();
  assert.equal(doc.getElementById("view-bskt").hidden, false);
  assert.equal(doc.getElementById("view-series7").hidden, true);
  assert.equal(dom.window.location.hash, "#bskt");
  assert.equal(doc.getElementById("bskt-root") != null, true);

  dom.window.location.hash = "#series7";
  await waitFor(() => doc.getElementById("view-series7").hidden === false && doc.getElementById("view-main").hidden === true, "hashchange");
  assert.equal(doc.getElementById("view-bskt").hidden, true);
});
