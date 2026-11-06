#!/usr/bin/env python3
"""Publish the Series 7 deck into this dashboard.

The study deck lives outside this repo and is updated over time at:

    /workspace/study-reader/flashcards/series7_cards.json

The Series 7 tab fetches only the copy in this folder:

    series7/series7_cards.json

Progress in the browser is stored by card id. This script copies ids exactly.
It does not invent, renumber, or rewrite them. Editing the front or back of an
existing id keeps that card's box and due date. A new id starts in box 1.
Removing an id takes the card out of review; if that id is published again,
the saved progress is used again.

The script writes nothing unless every card matches the deck schema.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

DECK_FIELDS = ("id", "chapter", "type", "front", "back")
TYPES = ("term", "concept")
DEFAULT_SOURCE = Path("/workspace/study-reader/flashcards/series7_cards.json")
MAX_TEXT = 8000


class DeckError(Exception):
    pass


def _fail(message: str) -> None:
    raise DeckError(message)


def validate_card(card, index: int) -> dict:
    where = f"card {index + 1}"
    if not isinstance(card, dict):
        _fail(f"{where} is not an object")
    extra = set(card) - set(DECK_FIELDS)
    if extra:
        _fail(f"{where} has unsupported fields: {', '.join(sorted(extra))}")
    missing = [key for key in DECK_FIELDS if key not in card]
    if missing:
        _fail(f"{where} is missing {', '.join(missing)}")

    card_id = card["id"]
    if not isinstance(card_id, str) or not _valid_id(card_id):
        _fail(f"{where} has an invalid id")
    chapter = card["chapter"]
    if isinstance(chapter, bool) or not isinstance(chapter, int) or not 0 <= chapter <= 999:
        _fail(f"{where} ({card_id}) needs a chapter number from 0 to 999")
    kind = card["type"]
    if kind not in TYPES:
        _fail(f"{where} ({card_id}) type must be term or concept")
    front = card["front"]
    back = card["back"]
    if not isinstance(front, str) or not front.strip() or len(front) > MAX_TEXT:
        _fail(f"{where} ({card_id}) needs a front")
    if not isinstance(back, str) or not back.strip() or len(back) > MAX_TEXT:
        _fail(f"{where} ({card_id}) needs a back")
    return {
        "id": card_id,
        "chapter": chapter,
        "type": kind,
        "front": front,
        "back": back,
    }


def _valid_id(value: str) -> bool:
    if not value or len(value) > 121:
        return False
    first, rest = value[0], value[1:]
    if first not in _ID_START or any(ch not in _ID_REST for ch in rest):
        return False
    return True


_ID_START = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
_ID_REST = _ID_START | set("._:-")


def load_deck(path: Path) -> list:
    if not path.is_file():
        _fail(f"Source file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        _fail(f"Source is not valid JSON: {exc}")
    if not isinstance(data, list):
        _fail("Source must be a list of cards")
    if not data:
        _fail("Source has no cards, so the published deck was left unchanged")
    cards = []
    seen = set()
    for index, raw in enumerate(data):
        card = validate_card(raw, index)
        if card["id"] in seen:
            _fail(f"Duplicate id {card['id']}")
        seen.add(card["id"])
        cards.append(card)
    return cards


def read_dest(path: Path) -> list:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out = []
    for index, raw in enumerate(data):
        try:
            out.append(validate_card(raw, index))
        except DeckError:
            return []
    return out


def diff_decks(previous: list, nxt: list) -> dict:
    old = {card["id"]: card for card in previous}
    new = {card["id"]: card for card in nxt}
    added = [card["id"] for card in nxt if card["id"] not in old]
    removed = [card_id for card_id in old if card_id not in new]
    changed = [card["id"] for card in nxt if card["id"] in old and old[card["id"]] != card]
    unchanged = [card["id"] for card in nxt if card["id"] in old and old[card["id"]] == card]
    return {"added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def format_deck(cards: list) -> str:
    return json.dumps(cards, ensure_ascii=False, indent=2) + "\n"


def write_deck(path: Path, cards: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = format_deck(cards)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def report(cards: list, changes: dict, dest: Path, wrote: bool) -> str:
    lines = [
        f"cards: {len(cards)}",
        f"added: {len(changes['added'])}",
        f"removed: {len(changes['removed'])}",
        f"changed: {len(changes['changed'])}",
        f"unchanged: {len(changes['unchanged'])}",
    ]
    if changes["added"]:
        lines.append("added ids:")
        lines.extend(f"  {card_id}" for card_id in changes["added"])
    if changes["removed"]:
        lines.append("removed ids (saved progress stays in each browser until this id is published again):")
        lines.extend(f"  {card_id}" for card_id in changes["removed"])
    if changes["changed"]:
        lines.append("changed ids (same id, so existing boxes and due dates stay):")
        lines.extend(f"  {card_id}" for card_id in changes["changed"])
    lines.append(("wrote " if wrote else "would write ") + str(dest))
    return "\n".join(lines)


def sync(source: Path, dest: Path, check: bool = False) -> str:
    cards = load_deck(source)
    changes = diff_decks(read_dest(dest), cards)
    wrote = False
    if not check:
        write_deck(dest, cards)
        wrote = True
    return report(cards, changes, dest, wrote)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Copy the study Series 7 deck into this dashboard.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Study deck JSON file")
    parser.add_argument("--dest", type=Path, default=Path(__file__).with_name("series7_cards.json"), help="Dashboard copy to publish")
    parser.add_argument("--check", action="store_true", help="Validate and print the diff without writing")
    args = parser.parse_args(argv)
    try:
        print(sync(args.source, args.dest, check=args.check))
    except DeckError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
