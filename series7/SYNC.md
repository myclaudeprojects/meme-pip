# Updating the Series 7 deck

The Series 7 tab loads its cards from `series7/series7_cards.json`. The cards are not copied into JavaScript. Progress is stored in this browser under the localStorage key `series7.leitner.v1`. That key is separate from the rest of the dashboard.

This site has no login, and the tab does not send progress to a server. Use Export backup on the Series 7 tab before switching devices or clearing site data. Import backup restores that file into the browser you are using.

## Where the deck comes from

The study deck is maintained at:

`/workspace/study-reader/flashcards/series7_cards.json`

That path is outside this repo. When it changes, copy it in with the sync script. The script checks every card before it replaces the file the site serves.

From the dashboard repo:

```bash
python3 series7/sync_cards.py --source /workspace/study-reader/flashcards/series7_cards.json
```

To see what would change without writing:

```bash
python3 series7/sync_cards.py --check --source /workspace/study-reader/flashcards/series7_cards.json
```

The script prints how many cards were added, removed, or edited. It only writes `series7/series7_cards.json`. A file that fails the checks does not replace the published deck.

Each card needs:

- `id`: a stable id such as `ch3-term-01`
- `chapter`: a whole number from 0 to 999
- `type`: `term` or `concept`
- `front` and `back`: the two sides of the card

## Keeping progress when the deck changes

Progress is matched by `id`.

- Keep the same id when you fix wording. People who already studied that card stay in the same box, with the same due date.
- Give a new card a new id. It starts in box 1 and is due the next time the tab is opened.
- Do not reuse an id for a different question. The old box and due date would apply to the new wording.
- If an id is removed, that card leaves the review queue. The browser still keeps progress for the id. If the id is published again, that progress comes back.

## How a review date is chosen

Dates use the calendar on the device, not a 24-hour timer and not UTC.

- A new card is in box 1 and is due today.
- Got it moves the card up one box. Box 5 stays at box 5.
- Missed it returns the card to box 1.
- The next review is 1, 3, 7, 14, or 30 days later for boxes 1 through 5, counted from the day you answered.
- Got it on a box 1 card moves it to box 2, due in 3 days. Missed it is due tomorrow.
- Today’s session shows only cards that are due today or earlier.

## Publishing the update

1. Run the sync script and read the summary.
2. Commit `series7/series7_cards.json`.
3. Open a pull request into the `organic-dashboard` branch and merge it.
4. The site at `https://organic-dashboard-np75.onrender.com` is the Render static site `organic-dashboard-np75`. It publishes the `organic-dashboard` branch. Wait until that deploy is live, then reload.
5. The tab is `https://organic-dashboard-np75.onrender.com/#series7`.

Confirm the new deck on that page before treating the update as live. A merged pull request is not live until the Render deploy for that commit has finished.

## Checks

```bash
node --test series7/series7.test.js
python3 series7/test_sync.py
```

The first command needs the test dependency installed once:

```bash
npm install --prefix series7
```
