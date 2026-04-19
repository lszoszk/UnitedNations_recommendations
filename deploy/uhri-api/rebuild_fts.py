#!/usr/bin/env python3
"""
rebuild_fts.py — create / rebuild the SQLite FTS5 text-search indexes for
the UHRI dataset. Standalone FTS5 (no external content), porter+unicode61
tokenizer (diacritic-insensitive, stemming for English).

Two indexes:
  - records_fts_cleaned : body (cleaned) + section headings
  - records_fts_raw     : body (original naive strip)

Idempotent: safe to re-run. Drops and recreates so we never end up
with a half-populated index.

Usage:
    python3 /opt/uhri/rebuild_fts.py [db_path]

Default db_path: /home/amuvmuser/echr-search/data/uhri-export.sqlite3
"""
from __future__ import annotations

import sqlite3
import sys
import time
from pathlib import Path


DEFAULT_DB = "/home/amuvmuser/echr-search/data/uhri-export.sqlite3"

TOKENIZER = "porter unicode61 remove_diacritics 2"


def rebuild(db_path: str) -> None:
    t0 = time.monotonic()

    # Open in WAL mode so readers keep working during rebuild.
    conn = sqlite3.connect(db_path, isolation_level=None, timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")

    # Verify FTS5 available before destroying anything.
    try:
        conn.execute("CREATE VIRTUAL TABLE _fts_probe USING fts5(x)").close()
        conn.execute("DROP TABLE _fts_probe")
    except sqlite3.OperationalError as exc:
        raise SystemExit(f"FTS5 not available on this sqlite build: {exc}")

    total_records = conn.execute("SELECT COUNT(*) FROM records").fetchone()[0]
    print(f"[fts] records in base table: {total_records:,}")

    # --- CLEANED index -----------------------------------------------------
    t = time.monotonic()
    conn.execute("DROP TABLE IF EXISTS records_fts_cleaned")
    conn.execute(
        f"""
        CREATE VIRTUAL TABLE records_fts_cleaned USING fts5(
            body_text,
            headings_text,
            tokenize='{TOKENIZER}'
        )
        """
    )
    conn.execute("BEGIN")
    conn.execute(
        """
        INSERT INTO records_fts_cleaned(rowid, body_text, headings_text)
        SELECT id,
               COALESCE(text_plain_cleaned, text_plain, ''),
               COALESCE(section_headings_text, '')
        FROM records
        """
    )
    conn.execute("COMMIT")
    conn.execute("INSERT INTO records_fts_cleaned(records_fts_cleaned) VALUES('optimize')")
    n_cleaned = conn.execute("SELECT COUNT(*) FROM records_fts_cleaned").fetchone()[0]
    print(
        f"[fts] records_fts_cleaned rebuilt: {n_cleaned:,} rows  "
        f"({time.monotonic() - t:.1f}s)"
    )

    # --- RAW index ---------------------------------------------------------
    t = time.monotonic()
    conn.execute("DROP TABLE IF EXISTS records_fts_raw")
    conn.execute(
        f"""
        CREATE VIRTUAL TABLE records_fts_raw USING fts5(
            body_text,
            tokenize='{TOKENIZER}'
        )
        """
    )
    conn.execute("BEGIN")
    conn.execute(
        """
        INSERT INTO records_fts_raw(rowid, body_text)
        SELECT id, COALESCE(text_plain, '') FROM records
        """
    )
    conn.execute("COMMIT")
    conn.execute("INSERT INTO records_fts_raw(records_fts_raw) VALUES('optimize')")
    n_raw = conn.execute("SELECT COUNT(*) FROM records_fts_raw").fetchone()[0]
    print(
        f"[fts] records_fts_raw rebuilt: {n_raw:,} rows  "
        f"({time.monotonic() - t:.1f}s)"
    )

    # --- Smoke test --------------------------------------------------------
    smoke_queries = ['"torture"*', '"women"* "rights"*', '"child"*']
    for q in smoke_queries:
        for tbl in ("records_fts_cleaned", "records_fts_raw"):
            cnt = conn.execute(
                f"SELECT COUNT(*) FROM {tbl} WHERE {tbl} MATCH ?", (q,)
            ).fetchone()[0]
            print(f"[fts] smoke: MATCH {q!r:30} on {tbl:22} → {cnt:,} hits")

    # --- DB stats ---------------------------------------------------------
    db_bytes = Path(db_path).stat().st_size
    print(f"[fts] DB size after rebuild: {db_bytes / (1024 ** 3):.2f} GB")

    conn.close()
    print(f"[fts] done in {time.monotonic() - t0:.1f}s")


def main() -> int:
    db_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB
    if not Path(db_path).exists():
        print(f"ERROR: db not found: {db_path}", file=sys.stderr)
        return 2
    rebuild(db_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
