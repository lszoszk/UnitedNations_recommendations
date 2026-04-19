#!/usr/bin/env python3
"""
Stage 6 — Artefact purge.

Hard-deletes records that are clearly noise / OCR residue rather than
substantive UN human-rights content. Every deleted record is dumped to
an audit JSONL before removal, so "rollback" = re-INSERT from that file.

Purge rules (all must be very conservative — we err on the side of
keeping ambiguous records).

Rule 1 — empty / trivially short:
    text (after TRIM + LOWER) length <= 5 chars
        e.g. ``""``, ``"1"``, ``"i"``, ``"-----"``, ``"Annex"``

Rule 2 — only digits / punctuation / whitespace:
    text strips to ``^[\\W\\d\\s]*$``  (no word chars at all)

Rule 3 — document-structure fragments (specific list, case-insensitive):
    {"annex", "contents", "introduction", "i. introduction",
     "i.introduction", "forty-third session", "i. introduction3",
     "table of contents"}

Rule 4 — governmental-response boilerplate:
    full text starts with "Comments by" AND mentions "not indexed"
        e.g. "Comments by the Government of ... are not indexed"
    (These records carry no substantive recommendation content — they
    are placeholders pointing the reader to an unindexed reply.)

We EXPLICITLY KEEP all records starting with a single lowercase letter
followed by ``)`` (e.g. ``"r) ratify OP-CAT"``) because these are
legitimate ratification recommendations enumerated as independent
paragraphs. The dataset has several dozen of them.

Usage
-----
    python3 stage6_artefact_purge.py                      # full delete + audit
    python3 stage6_artefact_purge.py --dry-run            # report only
    python3 stage6_artefact_purge.py --audit <path.jsonl> # override log dest
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from pathlib import Path


DEFAULT_DB = "/home/amuvmuser/echr-search/data/uhri-export.sqlite3"
DEFAULT_AUDIT = "/opt/uhri/pipeline/outputs/stage6/stage6_deleted.jsonl"

DOC_FRAGMENTS = {
    "annex", "contents", "introduction",
    "i. introduction", "i.introduction",
    "forty-third session", "i. introduction3",
    "table of contents",
}

_LETTER_PAREN = re.compile(r"^\s*[a-z]\)\s")   # preserves "r) ratify …"
_ONLY_NOISE   = re.compile(r"^[\W\d\s]*$")      # digits/punctuation/ws only


def _classify(text: str | None) -> str | None:
    """Return the rule name that flags this text, or None to keep."""
    if text is None:
        return "null_text"
    stripped = text.strip()
    lowered = stripped.lower()

    # Preserve ratification-letter style short recommendations
    if _LETTER_PAREN.match(stripped):
        return None

    # Rule 1 — trivially short
    if len(stripped) <= 5:
        return "rule1_short"

    # Rule 2 — only digits / punctuation / whitespace
    if _ONLY_NOISE.match(stripped):
        return "rule2_noise_only"

    # Rule 3 — known document-structure fragments
    if lowered in DOC_FRAGMENTS:
        return "rule3_doc_fragment"

    # Rule 4 — governmental-comments boilerplate
    if stripped.lower().startswith("comments by") and "not indexed" in stripped.lower():
        return "rule4_govt_boilerplate"

    return None


def _find_candidates(conn: sqlite3.Connection) -> list[dict]:
    """Return list of records that match any rule. Each entry is a dict
    with all columns needed for audit + deletion."""
    candidates = []
    cur = conn.execute("""
        SELECT id, annotation_id, body, symbol, publication_year,
               annotation_type,
               COALESCE(text_plain_cleaned, text_plain) AS t,
               text_plain_cleaned, text_plain
        FROM records
    """)
    for row in cur:
        rec = dict(zip(
            ("id", "annotation_id", "body", "symbol", "year",
             "annotation_type", "text_effective",
             "text_plain_cleaned", "text_plain"), row))
        reason = _classify(rec["text_effective"])
        if reason is not None:
            rec["reason"] = reason
            candidates.append(rec)
    return candidates


def _delete(conn: sqlite3.Connection, ids: list[int]) -> None:
    """Delete records + their join-table entries, in a single transaction."""
    if not ids:
        return
    placeholders = ",".join(["?"] * len(ids))
    conn.execute("BEGIN")
    for tbl in (
        "record_country", "record_theme", "record_affected_person",
        "record_sdg", "record_region",
    ):
        conn.execute(f"DELETE FROM {tbl} WHERE record_id IN ({placeholders})", ids)
    conn.execute(f"DELETE FROM records WHERE id IN ({placeholders})", ids)
    conn.execute("COMMIT")


def run(db_path: Path, audit_path: Path, dry_run: bool) -> dict:
    t0 = time.monotonic()
    conn = sqlite3.connect(str(db_path), timeout=60.0)

    candidates = _find_candidates(conn)

    # Distribution by reason
    from collections import Counter
    by_reason = Counter(c["reason"] for c in candidates)
    by_body   = Counter(c["body"]   for c in candidates)

    report = {
        "db_path": str(db_path),
        "total_records_before": conn.execute(
            "SELECT COUNT(*) FROM records").fetchone()[0],
        "candidates": len(candidates),
        "by_reason": dict(by_reason),
        "by_body": dict(by_body),
        "dry_run": dry_run,
    }

    if not dry_run:
        # Write audit log BEFORE deletion
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with audit_path.open("w", encoding="utf-8") as f:
            for c in candidates:
                f.write(json.dumps(c, ensure_ascii=False) + "\n")

        _delete(conn, [c["id"] for c in candidates])

        report["total_records_after"] = conn.execute(
            "SELECT COUNT(*) FROM records").fetchone()[0]
        report["audit_log"] = str(audit_path)

    conn.close()
    report["elapsed_ms"] = round((time.monotonic() - t0) * 1000)
    return report


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=Path(DEFAULT_DB))
    p.add_argument("--audit", type=Path, default=Path(DEFAULT_AUDIT))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    if not args.db.exists():
        print(f"DB not found: {args.db}", file=sys.stderr)
        return 2

    report = run(args.db, args.audit, args.dry_run)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    print("Stage 6 — artefact purge")
    print(f"  DB                    : {report['db_path']}")
    print(f"  records before        : {report['total_records_before']:>8,}")
    print(f"  candidates            : {report['candidates']:>8,}")
    if "total_records_after" in report:
        print(f"  records after         : {report['total_records_after']:>8,}")
    print(f"  dry-run               : {report['dry_run']}")
    if report["by_reason"]:
        print(f"  by reason:")
        for r, n in sorted(report["by_reason"].items()):
            print(f"    {r:25s} {n:>4}")
    if report["by_body"]:
        print(f"  by body:")
        for b, n in sorted(report["by_body"].items()):
            print(f"    {b!r:28} {n:>4}")
    if report.get("audit_log"):
        print(f"  audit log             : {report['audit_log']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
