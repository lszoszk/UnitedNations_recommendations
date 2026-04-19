#!/usr/bin/env python3
"""
Stage 5 — Body name canonicalization.

Rationale
---------
`records.body` values in the upstream UHRI export carry two inconsistent
shapes that hurt query performance and filter ergonomics:

1.  Every body name is stored with a leading ``"- "`` (dash + space)
    prefix. The materialised view `mv_entity_analytics` dropped that
    prefix when it was built, so MV lookups for e.g. ``body = "- UPR"``
    miss the ``"UPR"`` row and the API falls back to a 10 s SQL path.
    For the UPR profile (127 k records) this is the difference between a
    50 ms MV hit and an 11 s aggregation.

2.  Four Treaty Body committees appear with BOTH an acronym
    (``"- CRC"``, 21 767 records) AND a long form
    (``"- Committee on the Rights of the Child"``, 429 records). A
    researcher filtering on "CRC" silently misses the 429 long-form
    records; an aggregate count over the committee understates by the
    same margin. The symbol field (``CRC/C/XXX/...``) is authoritative —
    every record in both groups is a CRC document — so the split is a
    pure data-quality artefact on UHRI's side.

What this stage does
--------------------
- Adds ``records.body_source`` column (``upstream`` by default,
  ``canonicalized`` for rows we rewrote).
- Rewrites ``records.body`` in-place for two patterns:
    * strips leading ``"- "`` on every value (267 548 rows touched)
    * folds the four long-form Treaty Body variants into their canonical
      acronym (736 rows affected)
- Triggers a full MV rebuild (POST /api/data/mv/rebuild) so the
  ``mv_entity_analytics`` keys match the new ``records.body`` shape.
  Waits for the rebuild to finish before exiting.
- Emits a per-row action JSONL + a summary report.

The mapping is tiny (4 pairs) and hand-verified. We do NOT fuzzy-match
any other body-name shape, because UN bodies are well-defined and a
false merge would silently corrupt country-level analytics. Anything we
don't know, we leave alone.

Usage
-----
    python3 stage5_body_normalize.py                      # full run + MV rebuild
    python3 stage5_body_normalize.py --dry-run            # report only
    python3 stage5_body_normalize.py --skip-mv-rebuild    # just update records

Rollback
--------
    UPDATE records
       SET body = '- ' || body, body_source = 'upstream'
     WHERE body_source = 'canonicalized';
    POST /api/data/mv/rebuild
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path


DEFAULT_DB = "/home/amuvmuser/echr-search/data/uhri-export.sqlite3"

# Hand-verified synonyms — full name → canonical acronym.
# Source-of-truth: the UN document symbol of every record in both groups
# starts with the acronym, so the merge is safe by construction.
FULL_NAME_TO_ACRONYM = {
    "Committee on the Rights of the Child":                        "CRC",
    "Committee on the Elimination of Discrimination against Women": "CEDAW",
    "Committee on Migrant Workers":                                 "CMW",
    "Committee on Economic, Social and Cultural Rights":            "CESCR",
}

# Tiny typo fix observed in the corpus.
WHITESPACE_FIXES = {
    "IE  Albinism": "IE Albinism",   # double space → single
}


def _ensure_source_column(conn: sqlite3.Connection) -> None:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(records)")]
    if "body_source" not in cols:
        conn.execute("ALTER TABLE records ADD COLUMN body_source TEXT DEFAULT 'upstream'")
        conn.execute("UPDATE records SET body_source='upstream' WHERE body_source IS NULL")
        conn.commit()


def _snapshot_bodies(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        row[0]: row[1]
        for row in conn.execute("SELECT body, COUNT(*) FROM records GROUP BY body")
    }


def _trigger_mv_rebuild(timeout_s: int = 240) -> dict:
    """POST /api/data/mv/rebuild, poll /api/data/mv/status until done."""
    try:
        r = subprocess.check_output([
            "curl", "-sSk", "-X", "POST", "-H", "Content-Type: application/json",
            "http://127.0.0.1:8000/api/data/mv/rebuild",
        ], timeout=10)
        kickoff = json.loads(r.decode())
    except Exception as e:
        return {"ok": False, "phase": "kickoff", "error": str(e)}

    deadline = time.monotonic() + timeout_s
    last_status = None
    while time.monotonic() < deadline:
        try:
            r = subprocess.check_output([
                "curl", "-sSk", "http://127.0.0.1:8000/api/data/mv/status",
            ], timeout=10)
            last_status = json.loads(r.decode())
            if not last_status.get("building"):
                return {
                    "ok": True,
                    "kickoff": kickoff,
                    "final_status": last_status,
                    "seconds_waited": round(timeout_s - (deadline - time.monotonic()), 1),
                }
        except Exception as e:
            last_status = {"error": str(e)}
        time.sleep(3)

    return {"ok": False, "phase": "timeout", "last_status": last_status}


def run(db_path: Path, out_jsonl: Path | None, dry_run: bool,
        skip_mv_rebuild: bool) -> dict:
    t0 = time.monotonic()
    conn = sqlite3.connect(str(db_path), timeout=60.0)

    _ensure_source_column(conn)

    before_snapshot = _snapshot_bodies(conn)

    report: dict = {
        "db_path": str(db_path),
        "bodies_distinct_before": len(before_snapshot),
        "records_total": sum(before_snapshot.values()),
        "stripped_prefix": 0,
        "merged_synonyms": {},
        "whitespace_fixed": {},
        "bodies_distinct_after": 0,
        "dry_run": dry_run,
    }

    actions: list[dict] = []

    # Read every distinct body and decide its fate
    transforms: list[tuple[str, str, str]] = []  # (old, new, reason)
    for old in before_snapshot:
        if old is None:
            continue
        new = old
        reasons = []

        # 1. Full-name synonym (before prefix strip — the full names also
        #    have a leading "- " so match against the stripped form).
        stripped_once = new.lstrip("- ").strip() if new.startswith("- ") else new.strip()
        if stripped_once in FULL_NAME_TO_ACRONYM:
            new_base = FULL_NAME_TO_ACRONYM[stripped_once]
            reasons.append(f"synonym:{stripped_once!r}->{new_base!r}")
            new = new_base
        elif stripped_once in WHITESPACE_FIXES:
            new_base = WHITESPACE_FIXES[stripped_once]
            reasons.append(f"whitespace:{stripped_once!r}->{new_base!r}")
            new = new_base
        else:
            new = stripped_once if new.startswith("- ") else new

        # 2. Strip leading "- " (applies universally after synonym/whitespace
        #    fixes have already removed it in their path)
        if old.startswith("- ") and not reasons:
            reasons.append("strip-prefix")

        if new != old:
            transforms.append((old, new, ";".join(reasons)))

    # Apply transforms
    for old, new, reason in transforms:
        n_affected = before_snapshot.get(old, 0)
        if not dry_run:
            conn.execute(
                "UPDATE records SET body = ?, body_source = 'canonicalized' "
                "WHERE body = ?",
                (new, old),
            )
        if "strip-prefix" in reason:
            report["stripped_prefix"] += n_affected
        if "synonym" in reason:
            report["merged_synonyms"][f"{old} -> {new}"] = n_affected
        if "whitespace" in reason:
            report["whitespace_fixed"][f"{old} -> {new}"] = n_affected
        actions.append({
            "old": old, "new": new, "reason": reason, "records": n_affected,
        })

    if not dry_run:
        conn.commit()

    after_snapshot = _snapshot_bodies(conn)
    report["bodies_distinct_after"] = len(after_snapshot)
    report["elapsed_ms"] = round((time.monotonic() - t0) * 1000)

    # Per-action log
    if out_jsonl is not None:
        out_jsonl.parent.mkdir(parents=True, exist_ok=True)
        with out_jsonl.open("w", encoding="utf-8") as f:
            for a in actions:
                f.write(json.dumps(a, ensure_ascii=False) + "\n")

    conn.close()

    # Trigger MV rebuild if requested
    if not dry_run and not skip_mv_rebuild and transforms:
        print("--- triggering MV rebuild ---", flush=True)
        report["mv_rebuild"] = _trigger_mv_rebuild()

    return report


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=Path(DEFAULT_DB))
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--skip-mv-rebuild", action="store_true")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    if not args.db.exists():
        print(f"DB not found: {args.db}", file=sys.stderr)
        return 2

    report = run(args.db, args.out, args.dry_run, args.skip_mv_rebuild)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    print(f"Stage 5 — body canonicalization")
    print(f"  DB                      : {report['db_path']}")
    print(f"  bodies distinct BEFORE  : {report['bodies_distinct_before']}")
    print(f"  bodies distinct AFTER   : {report['bodies_distinct_after']}")
    print(f"  records touched         :")
    print(f"    strip leading '- '    : {report['stripped_prefix']:>7,}")
    for k, n in report["merged_synonyms"].items():
        print(f"    merge   {k}   : {n:>6,}")
    for k, n in report["whitespace_fixed"].items():
        print(f"    fix ws  {k}   : {n:>6,}")
    print(f"  elapsed                 : {report['elapsed_ms']} ms")
    print(f"  dry-run                 : {report['dry_run']}")
    if "mv_rebuild" in report:
        mv = report["mv_rebuild"]
        print(f"  MV rebuild              : ok={mv.get('ok')} waited={mv.get('seconds_waited')}s")
        if mv.get("final_status"):
            print(f"    entities={mv['final_status'].get('entities_total')} "
                  f"fingerprint={mv['final_status'].get('fingerprint')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
