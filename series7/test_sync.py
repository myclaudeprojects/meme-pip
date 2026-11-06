#!/usr/bin/env python3
"""Checks for the Series 7 deck sync script."""

import json
import tempfile
import unittest
from pathlib import Path

import sync_cards


GOOD = {
    "id": "ch3-term-01",
    "chapter": 3,
    "type": "term",
    "front": "EMMA",
    "back": "Electronic Municipal Market Access.",
}


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class SyncTests(unittest.TestCase):
    def test_preserves_ids_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.json"
            dest = root / "series7_cards.json"
            cards = [
                GOOD,
                {"id": "ch9-concept-10", "chapter": 9, "type": "concept", "front": "Basis", "back": "How basis works."},
            ]
            write_json(source, cards)
            first = sync_cards.sync(source, dest, check=False)
            self.assertIn("added: 2", first)
            stored = json.loads(dest.read_text(encoding="utf-8"))
            self.assertEqual([card["id"] for card in stored], ["ch3-term-01", "ch9-concept-10"])
            self.assertEqual(stored[0]["front"], "EMMA")
            second = sync_cards.sync(source, dest, check=False)
            self.assertIn("added: 0", second)
            self.assertIn("removed: 0", second)
            self.assertIn("changed: 0", second)
            self.assertEqual(dest.read_text(encoding="utf-8"), sync_cards.format_deck(cards))

    def test_content_edit_keeps_id_and_new_id_is_added(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.json"
            dest = root / "series7_cards.json"
            write_json(dest, [GOOD])
            updated = dict(GOOD, back="Updated wording.")
            added = {"id": "ch4-term-01", "chapter": 4, "type": "term", "front": "New", "back": "Brand new card."}
            write_json(source, [updated, added])
            report = sync_cards.sync(source, dest, check=False)
            self.assertIn("changed: 1", report)
            self.assertIn("ch3-term-01", report)
            self.assertIn("added: 1", report)
            self.assertIn("ch4-term-01", report)
            stored = json.loads(dest.read_text(encoding="utf-8"))
            self.assertEqual(stored[0]["id"], "ch3-term-01")
            self.assertEqual(stored[0]["back"], "Updated wording.")
            self.assertEqual(stored[1]["id"], "ch4-term-01")

    def test_removed_id_is_reported_and_not_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.json"
            dest = root / "series7_cards.json"
            other = {"id": "ch4-term-02", "chapter": 4, "type": "term", "front": "Keep", "back": "Stays."}
            write_json(dest, [GOOD, other])
            write_json(source, [other])
            report = sync_cards.sync(source, dest, check=False)
            self.assertIn("removed: 1", report)
            self.assertIn("ch3-term-01", report)
            stored = json.loads(dest.read_text(encoding="utf-8"))
            self.assertEqual([card["id"] for card in stored], ["ch4-term-02"])

    def test_invalid_source_does_not_replace_dest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.json"
            dest = root / "series7_cards.json"
            write_json(dest, [GOOD])
            before = dest.read_text(encoding="utf-8")
            cases = [
                [],
                {"id": "ch3-term-01"},
                [dict(GOOD, id="ch3-term-01"), dict(GOOD, id="ch3-term-01", front="Other")],
                [dict(GOOD, type="note")],
                [dict(GOOD, chapter=True)],
                [dict(GOOD, chapter=3.5)],
                [dict(GOOD, front="  ")],
                [dict(GOOD, extra="nope")],
                [dict(GOOD, id="")],
            ]
            for data in cases:
                write_json(source, data)
                with self.assertRaises(sync_cards.DeckError):
                    sync_cards.sync(source, dest, check=False)
                self.assertEqual(dest.read_text(encoding="utf-8"), before)

    def test_check_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.json"
            dest = root / "series7_cards.json"
            write_json(source, [GOOD])
            report = sync_cards.sync(source, dest, check=True)
            self.assertIn("would write", report)
            self.assertFalse(dest.exists())

    def test_missing_source_leaves_dest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dest = root / "series7_cards.json"
            write_json(dest, [GOOD])
            before = dest.read_text(encoding="utf-8")
            with self.assertRaises(sync_cards.DeckError):
                sync_cards.sync(root / "missing.json", dest, check=False)
            self.assertEqual(dest.read_text(encoding="utf-8"), before)

    def test_published_deck_syncs_without_changes(self):
        published = Path(__file__).with_name("series7_cards.json")
        self.assertTrue(published.is_file(), "series7_cards.json is missing")
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "series7_cards.json"
            dest.write_text(published.read_text(encoding="utf-8"), encoding="utf-8")
            report = sync_cards.sync(published, dest, check=True)
            self.assertIn("added: 0", report)
            self.assertIn("removed: 0", report)
            self.assertIn("changed: 0", report)
            self.assertEqual(dest.read_text(encoding="utf-8"), published.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
