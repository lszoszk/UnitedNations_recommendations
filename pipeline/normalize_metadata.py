#!/usr/bin/env python3
"""Fold split metadata vocabularies in the UHRI export DATABASE.

WHERE THIS SITS (corrected 2026-08-05)
--------------------------------------
An earlier version of this header claimed the pipeline's normaliser existed
nowhere. That was wrong, and the mistake is worth recording: the search that
"proved" it was a `sudo find` that failed silently on a password prompt, and
an empty result was read as an answer.

The real normaliser lives on the VM at
`~/uhri/data/pipeline/normalize_metadata.py`. It carries 17 committee-name
mappings (more than this file) and a country backfill from UN document
symbols, and it patches the SOURCE export — the right place, because every
SQLite rebuild then starts from canonical data.

The actual gap was upstream of both: `uhri_monthly_sync.py` merges each
month's new records and restarts the API to rebuild, but never called the
normaliser. Its own docstring says to re-run it after every fresh download;
nothing did. So each monthly merge silently re-split the vocabulary.

This file stays as the BREAK-GLASS tool for the other direction: repairing a
database that has already been built from un-normalised source, without
re-downloading or rebuilding 1.5 GB. It is what fixed the live corpus on
2026-08-05. For the durable fix, normalise the source and wire it into the
sync.

WHAT IT FOLDS
-------------
The upstream OHCHR export spells some entities two ways, and every split
vocabulary silently hides records from anyone who filters by the canonical
form. Two families have been found in production:

  * COMMITTEE NAMES — 271 recommendations arrived under
    "Committee on the Elimination of Discrimination against Women" /
    "...of Racial Discrimination" while 32k sat under "CEDAW" / "CERD".
    Filtering by the committee missed them entirely. Caught by the nightly
    `data canon guard`, which asserts the API serves exactly 70 bodies.

  * COUNTRY CODES — 1,162 recommendations carry a bare ISO-2 code ("IQ",
    "PK") while their full-name twin holds the rest ("Iraq" 1,965,
    "Pakistan" 1,525). Every one of the 20 codes has a twin, so every one
    is a split. Nothing guards this yet.

The front end already folds both families for display (cleanCountryName /
cleanLabel in dashboard-helpers.js), which is why the dashboard looks
right while the underlying filter misses rows. This script fixes the data
so the two agree.

IDEMPOTENT: safe to re-run. A second run reports zero changes.

USAGE
-----
Dry run (default — reports, writes nothing):
    docker exec -i uhri-dataset-api python3 - < pipeline/normalize_metadata.py

Apply:
    docker exec -i uhri-dataset-api python3 - --apply < pipeline/normalize_metadata.py

TAKE A BACKUP FIRST. The file is ~1.5 GB and the container owns it:
    docker exec uhri-dataset-api python3 -c "import sqlite3;\
        s=sqlite3.connect('/data/uhri-export.sqlite3');\
        d=sqlite3.connect('/data/uhri-export.sqlite3.bak-normalize-$(date -u +%Y%m%d-%H%M%S)');\
        s.backup(d)"

WHY THE MV DELETES ARE NOT OPTIONAL
-----------------------------------
mv_entity_analytics rows are validated against a fingerprint of
"{schema_version}:{row_count}" (unhr_dataset_api.py:_mv_fingerprint).
Folding a vocabulary changes no row count, so the cache would keep serving
the pre-fold numbers for both the source and the target entity. Deleting
the affected rows makes _mv_get return None and the API recomputes and
re-caches them on the next request.

Nothing else needs rebuilding: the FTS tables index only body_text and
headings_text (the recommendation prose), not these fields, and `records`
carries no triggers.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys

DEFAULT_DB = "/data/uhri-export.sqlite3"

# Full committee name -> acronym. Values are stored with OHCHR's "- " prefix;
# the prefix is handled generically below, so write the bare forms here.
BODY_FOLD = {
    "Committee on the Elimination of Discrimination against Women": "CEDAW",
    "Committee on the Elimination of Racial Discrimination": "CERD",
}

# Bare ISO-2 code -> the full name the corpus uses elsewhere. This is the
# front end's ISO2_TO_NAME plus the five it is missing (CU, CY, RS, SI, UZ),
# which is why those five still showed as bare codes in the country facet.
ISO2_TO_NAME = {
    "AU": "Australia",   "CA": "Canada",     "CO": "Colombia",  "CU": "Cuba",
    "CY": "Cyprus",      "CZ": "Czechia",    "ES": "Spain",     "ET": "Ethiopia",
    "GH": "Ghana",       "ID": "Indonesia",  "IQ": "Iraq",      "MV": "Maldives",
    "MY": "Malaysia",    "PK": "Pakistan",   "RS": "Serbia",    "SG": "Singapore",
    "SI": "Slovenia",    "SV": "El Salvador", "UZ": "Uzbekistan", "WS": "Samoa",
}


def _variants(name: str) -> list[str]:
    """Both spellings a value can have in the export: bare and "- "-prefixed."""
    bare = name[2:] if name.startswith("- ") else name
    return [bare, f"- {bare}"]


def plan_bodies(conn: sqlite3.Connection) -> list[tuple[str, str, int]]:
    out = []
    for src, dst in BODY_FOLD.items():
        for variant in _variants(src):
            n = conn.execute("SELECT COUNT(*) FROM records WHERE Body = ?", (variant,)).fetchone()[0]
            if n:
                target = f"- {dst}" if variant.startswith("- ") else dst
                out.append((variant, target, n))
    return out


def plan_countries(conn: sqlite3.Connection) -> list[tuple[str, str, int]]:
    out = []
    for code, name in ISO2_TO_NAME.items():
        n = conn.execute("SELECT COUNT(*) FROM record_country WHERE value = ?", (code,)).fetchone()[0]
        if n:
            out.append((code, name, n))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write; without it this only reports")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    rows_before = conn.execute("SELECT COUNT(*) FROM records").fetchone()[0]
    links_before = conn.execute("SELECT COUNT(*) FROM record_country").fetchone()[0]

    bodies = plan_bodies(conn)
    countries = plan_countries(conn)

    print(f"database: {args.db}")
    print(f"records: {rows_before}   country links: {links_before}\n")

    if not bodies and not countries:
        print("nothing to fold — vocabularies are already canonical.")
        return 0

    print("COMMITTEE NAMES")
    for src, dst, n in bodies or []:
        print(f"  {n:>6}  {src!r} -> {dst!r}")
    if not bodies:
        print("       -  (already canonical)")

    print("\nCOUNTRY CODES")
    for src, dst, n in countries or []:
        print(f"  {n:>6}  {src!r} -> {dst!r}")
    if not countries:
        print("       -  (already canonical)")

    total = sum(n for *_, n in bodies) + sum(n for *_, n in countries)
    print(f"\n{total} rows would move.")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply to commit.")
        return 0

    conn.execute("BEGIN")

    for src, dst, _ in bodies:
        conn.execute("UPDATE records SET Body = ? WHERE Body = ?", (dst, src))

    for src, dst, _ in countries:
        conn.execute("UPDATE record_country SET value = ? WHERE value = ?", (dst, src))

    # A record could in principle hold both the code and the full name; after
    # the fold that becomes a duplicate link, which would double-count the
    # record in every country facet. There is no UNIQUE index to stop it.
    dupes = conn.execute(
        "DELETE FROM record_country WHERE rowid NOT IN "
        "(SELECT MIN(rowid) FROM record_country GROUP BY record_id, value)"
    ).rowcount

    # See the module docstring: the fingerprint cannot notice a fold, so the
    # cached analytics for BOTH sides have to go.
    touched = set()
    for src, dst, _ in bodies:
        touched.add(("body", src.removeprefix("- ")))
        touched.add(("body", dst.removeprefix("- ")))
    for src, dst, _ in countries:
        touched.add(("country", src))
        touched.add(("country", dst))
    mv = 0
    for etype, evalue in touched:
        mv += conn.execute(
            "DELETE FROM mv_entity_analytics WHERE entity_type = ? AND entity_value = ?",
            (etype, evalue),
        ).rowcount

    conn.commit()

    rows_after = conn.execute("SELECT COUNT(*) FROM records").fetchone()[0]
    links_after = conn.execute("SELECT COUNT(*) FROM record_country").fetchone()[0]
    print(f"\napplied. duplicate country links removed: {dupes}")
    print(f"stale MV rows dropped: {mv} (they recompute live on the next request)")
    print(f"records: {rows_before} -> {rows_after}   country links: {links_before} -> {links_after}")

    if rows_after != rows_before:
        print("\nRECORD COUNT CHANGED — restore from the backup.", file=sys.stderr)
        return 1
    if links_after != links_before - dupes:
        print("\nCOUNTRY LINK COUNT UNEXPECTED — restore from the backup.", file=sys.stderr)
        return 1

    leftover_bodies = conn.execute(
        "SELECT COUNT(*) FROM records WHERE Body LIKE '%Committee on the Elimination%'"
    ).fetchone()[0]
    leftover_codes = conn.execute(
        "SELECT COUNT(*) FROM record_country WHERE LENGTH(value) = 2 AND value = UPPER(value)"
    ).fetchone()[0]
    print(f"leftover split committee names: {leftover_bodies}   leftover bare codes: {leftover_codes}")

    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    print("\ndone — re-run this script to confirm it now reports nothing to fold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
