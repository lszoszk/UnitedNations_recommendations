#!/usr/bin/env python3
"""
Stage 4 — Country backfill from UN document symbol.

Rationale
---------
Of 267 548 records in the upstream UHRI export, 108 (0.04 %) arrive with
zero country metadata. For 107 of those, the country is LITERALLY encoded
in the UN document symbol: `CEDAW/C/ALB/CO/4` is addressed to Albania,
`CRPD/C/AZE/CO/1` to Azerbaijan, and so on. These are all Concluding
Observations / country-visit reports where the annotation-level country
field was dropped during UHRI's normalisation.

Algorithm (fully deterministic, no AI)
--------------------------------------
1.  Build an ISO-alpha-3 → country-name mapping from the existing dataset:
    examine every record that has BOTH a symbol AND at least one country,
    extract the code via regex, and collect all country names seen for
    that code. Filter out values that are 2-letter stubs (e.g. "ES", "CO"
    — these are UHRI data-quality artefacts, not real country names).
    Keep the most common country per code as the canonical mapping.

2.  For every country-less record, try to extract an alpha-3 from its
    symbol. If the code resolves to a canonical country, add a new row
    to `record_country` with `value = canonical` and `source = "inferred:symbol"`.
    If no code, or code not in the lookup, leave empty and flag "unresolved".

3.  Emit a JSONL of backfill actions plus a summary report.

Provenance
----------
Each insert is tagged with a `source` column so the audit trail is
explicit. An existing record is never modified; this stage only APPENDS
missing country rows. A rollback is therefore a trivial SQL:
    DELETE FROM record_country WHERE source = 'inferred:symbol';

Usage
-----
    python3 stage4_country_backfill.py                     # full run
    python3 stage4_country_backfill.py --dry-run           # report only
    python3 stage4_country_backfill.py --db <path>         # override DB path

Defaults pick up /home/amuvmuser/echr-search/data/uhri-export.sqlite3 on
the VM and the pipeline-sibling path when running locally.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path


# UN treaty-body symbol patterns that carry a country code between the
# body acronym and the document subtype. This covers:
#   CRPD/C/AZE/CO/1                 — Concluding Observations
#   CERD/C/THA/CO/1-3               — multi-cycle
#   CAT/OP/HND/1                    — Subcommittee on Prevention of Torture
#   CCPR/C/ESP/CO/5/ADD.1           — government comments addendum
# It deliberately does NOT attempt to parse SR thematic reports like
# A/HRC/15/37 — those do not carry a country code.
_SYMBOL_CODE_RE = re.compile(r"^[A-Z\-]+/(?:C|OP|TYP)/([A-Z]{2,3})/")


def _build_mapping(conn: sqlite3.Connection) -> dict[str, str]:
    """Derive alpha-3 → canonical country name from existing joined data."""
    code_counts: dict[str, Counter] = defaultdict(Counter)
    cur = conn.execute(
        """
        SELECT r.symbol, rc.value
        FROM records r
        JOIN record_country rc ON r.id = rc.record_id
        WHERE r.symbol IS NOT NULL AND r.symbol != ''
        """
    )
    for symbol, country in cur:
        m = _SYMBOL_CODE_RE.match(symbol)
        if not m:
            continue
        country = (country or "").strip()
        # Reject 2-letter / numeric / empty — they're data artefacts, not
        # real country names. Real country names are always ≥4 chars
        # (shortest legit UN country name is "Chad" at 4 chars).
        if len(country) < 4:
            continue
        code_counts[m.group(1)][country] += 1

    mapping: dict[str, str] = {}
    for code, counts in code_counts.items():
        top_country, _ = counts.most_common(1)[0]
        mapping[code] = top_country
    return mapping


def _countryless_records(conn: sqlite3.Connection) -> list[tuple[int, str, str]]:
    """Return (id, annotation_id, symbol) for every record with zero countries."""
    return conn.execute(
        """
        SELECT r.id, r.annotation_id, COALESCE(r.symbol, '')
        FROM records r
        LEFT JOIN record_country rc ON r.id = rc.record_id
        WHERE rc.record_id IS NULL
        """
    ).fetchall()


def _ensure_source_column(conn: sqlite3.Connection) -> None:
    """Add a `source` column to record_country if missing (idempotent).
    'upstream' for rows inserted by build_db.py from UHRI metadata,
    'inferred:symbol' for backfills from this stage."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(record_country)")]
    if "source" not in cols:
        conn.execute("ALTER TABLE record_country ADD COLUMN source TEXT DEFAULT 'upstream'")
        conn.execute("UPDATE record_country SET source='upstream' WHERE source IS NULL")
        conn.commit()


def run(
    db_path: Path,
    out_jsonl: Path | None = None,
    dry_run: bool = False,
) -> dict:
    t0 = time.monotonic()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    _ensure_source_column(conn)
    mapping = _build_mapping(conn)
    rows = _countryless_records(conn)

    report: dict = {
        "db_path": str(db_path),
        "mapping_size": len(mapping),
        "records_countryless_before": len(rows),
        "resolved": 0,
        "unresolved": 0,
        "by_body": Counter(),
        "by_country_resolved": Counter(),
        "unresolved_symbols": [],
        "dry_run": dry_run,
    }

    actions: list[dict] = []
    to_insert: list[tuple[int, str, str]] = []

    for rec_id, annotation_id, symbol in rows:
        m = _SYMBOL_CODE_RE.match(symbol)
        if not m:
            report["unresolved"] += 1
            report["unresolved_symbols"].append(symbol or "(none)")
            actions.append({
                "annotation_id": annotation_id,
                "symbol": symbol,
                "action": "unresolved",
                "reason": "no country code in symbol",
            })
            continue

        code = m.group(1)
        country = mapping.get(code)
        if not country:
            report["unresolved"] += 1
            report["unresolved_symbols"].append(f"{symbol} [code={code}]")
            actions.append({
                "annotation_id": annotation_id,
                "symbol": symbol,
                "code": code,
                "action": "unresolved",
                "reason": f"code {code} not in derived mapping",
            })
            continue

        report["resolved"] += 1
        report["by_country_resolved"][country] += 1
        to_insert.append((rec_id, country, "inferred:symbol"))
        actions.append({
            "annotation_id": annotation_id,
            "symbol": symbol,
            "code": code,
            "action": "insert",
            "country": country,
        })

    # Also aggregate by body for reporting
    for rec_id, _, _ in rows:
        body = conn.execute(
            "SELECT body FROM records WHERE id = ?", (rec_id,)
        ).fetchone()
        if body and body[0]:
            report["by_body"][body[0].lstrip("- ").strip()] += 1

    if not dry_run and to_insert:
        conn.executemany(
            "INSERT INTO record_country (record_id, value, source) VALUES (?, ?, ?)",
            to_insert,
        )
        conn.commit()

    report["elapsed_ms"] = round((time.monotonic() - t0) * 1000)

    if out_jsonl is not None:
        out_jsonl.parent.mkdir(parents=True, exist_ok=True)
        with out_jsonl.open("w", encoding="utf-8") as f:
            for a in actions:
                f.write(json.dumps(a, ensure_ascii=False) + "\n")

    # Post-run sanity: re-count country-less records
    after = conn.execute(
        """
        SELECT COUNT(*) FROM records r
        LEFT JOIN record_country rc ON r.id = rc.record_id
        WHERE rc.record_id IS NULL
        """
    ).fetchone()[0]
    report["records_countryless_after"] = after
    conn.close()
    return report


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--db",
        type=Path,
        default=Path("/home/amuvmuser/echr-search/data/uhri-export.sqlite3"),
        help="SQLite database path",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional JSONL of per-record backfill actions",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--json", action="store_true", help="Print report as JSON")
    args = p.parse_args()

    if not args.db.exists():
        print(f"DB not found: {args.db}", file=sys.stderr)
        return 2

    report = run(args.db, args.out, args.dry_run)

    if args.json:
        # Convert Counter → plain dict for JSON
        report_serialisable = dict(report)
        report_serialisable["by_body"] = dict(report["by_body"])
        report_serialisable["by_country_resolved"] = dict(report["by_country_resolved"])
        print(json.dumps(report_serialisable, indent=2, ensure_ascii=False))
        return 0

    print(f"Stage 4 — country backfill")
    print(f"  DB              : {report['db_path']}")
    print(f"  mapping size    : {report['mapping_size']} codes")
    print(f"  countryless IN  : {report['records_countryless_before']}")
    print(f"  resolved        : {report['resolved']}")
    print(f"  unresolved      : {report['unresolved']}")
    print(f"  countryless OUT : {report['records_countryless_after']}")
    print(f"  elapsed         : {report['elapsed_ms']} ms")
    print(f"  dry-run         : {report['dry_run']}")
    if report["by_body"]:
        print(f"  by body (before):")
        for b, n in report["by_body"].most_common():
            print(f"    {b:25s} {n:>4}")
    if report["by_country_resolved"]:
        print(f"  by country (resolved):")
        for c, n in report["by_country_resolved"].most_common(15):
            print(f"    {c:35s} {n:>4}")
    if report["unresolved_symbols"]:
        print(f"  unresolved symbols:")
        for s in report["unresolved_symbols"][:20]:
            print(f"    {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
