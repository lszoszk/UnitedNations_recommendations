#!/usr/bin/env python3
"""
patch_fts5_backend.py — in-place patch of unhr_dataset_api.py that replaces
the LIKE-based text-search clauses with FTS5 MATCH on records_fts_cleaned /
records_fts_raw.

Idempotent: running twice is a no-op (grep check skips).

Backs up the original to <path>.pre-fts5.<timestamp>.
"""
from __future__ import annotations

import re
import shutil
import sys
import time
from pathlib import Path


DEFAULT_PATH = "/home/amuvmuser/echr-search/backend/unhr_dataset_api.py"


# ----- New helper to inject -------------------------------------------------
HELPER = '''

# --------------------------------------------------------------------------
# FTS5 helpers (added by patch_fts5_backend.py)
# --------------------------------------------------------------------------
def _fts5_escape(needle: str) -> str:
    """Turn a user-typed search string into a safe FTS5 MATCH expression.

    Each whitespace-split token is double-quoted (with internal " doubled)
    and given a trailing * for prefix matching. Tokens are joined by a
    single space, which FTS5 treats as an implicit AND. Empty input → ''.
    """
    text = (needle or "").strip()
    if not text:
        return ""
    out = []
    for token in text.split():
        q = token.replace('"', '""')
        out.append(f'"{q}"*')
    return " ".join(out)

'''

# Marker for idempotency
MARKER = "def _fts5_escape("


# ----- Old block to replace -------------------------------------------------
OLD_BLOCK = '''    text_query = filters["text_query"]
    if text_query:
        dataset = filters.get("dataset") or "cleaned"
        if dataset == "cleaned":
            # Cleaned-dataset search: the pipeline's refined body text PLUS
            # the extracted section headings. The COALESCE falls back to
            # the naïve strip for records whose cleaned field is empty so
            # legacy records stay searchable.
            body_col = "COALESCE(r.text_plain_cleaned, r.text_plain)"
            head_col = "r.section_headings_text"
            if text_query["mode"] == "plain":
                clauses.append(
                    f"(LOWER({body_col}) LIKE ? OR LOWER(COALESCE({head_col}, '')) LIKE ?)"
                )
                needle = f"%{text_query['needle']}%"
                params.extend([needle, needle])
            else:
                clauses.append(
                    f"(REGEXP(?, {body_col}) OR REGEXP(?, COALESCE({head_col}, '')))"
                )
                rule = json.dumps(
                    {"pattern": text_query["pattern"], "flags": text_query["flags"]}
                )
                params.extend([rule, rule])
        else:
            # Raw/upstream dataset: legacy behaviour, body column only.
            if text_query["mode"] == "plain":
                clauses.append("LOWER(r.text_plain) LIKE ?")
                params.append(f"%{text_query['needle']}%")
            else:
                clauses.append("REGEXP(?, r.text_plain)")
                params.append(json.dumps({"pattern": text_query["pattern"], "flags": text_query["flags"]}))'''


NEW_BLOCK = '''    text_query = filters["text_query"]
    if text_query:
        dataset = filters.get("dataset") or "cleaned"
        if dataset == "cleaned":
            body_col = "COALESCE(r.text_plain_cleaned, r.text_plain)"
            head_col = "r.section_headings_text"
            if text_query["mode"] == "plain":
                # FTS5 fast path: records_fts_cleaned covers body+headings.
                fts_q = _fts5_escape(text_query["needle"])
                if fts_q:
                    clauses.append(
                        "r.id IN (SELECT rowid FROM records_fts_cleaned "
                        "WHERE records_fts_cleaned MATCH ?)"
                    )
                    params.append(fts_q)
                else:
                    clauses.append("1=0")
            else:
                # Regex fallback (slow) — unchanged.
                clauses.append(
                    f"(REGEXP(?, {body_col}) OR REGEXP(?, COALESCE({head_col}, '')))"
                )
                rule = json.dumps(
                    {"pattern": text_query["pattern"], "flags": text_query["flags"]}
                )
                params.extend([rule, rule])
        else:
            # Raw/upstream dataset.
            if text_query["mode"] == "plain":
                fts_q = _fts5_escape(text_query["needle"])
                if fts_q:
                    clauses.append(
                        "r.id IN (SELECT rowid FROM records_fts_raw "
                        "WHERE records_fts_raw MATCH ?)"
                    )
                    params.append(fts_q)
                else:
                    clauses.append("1=0")
            else:
                clauses.append("REGEXP(?, r.text_plain)")
                params.append(json.dumps({"pattern": text_query["pattern"], "flags": text_query["flags"]}))'''


def patch(path: str) -> bool:
    """Apply the patch. Returns True if anything changed."""
    p = Path(path)
    src = p.read_text(encoding="utf-8")

    if MARKER in src:
        print(f"[patch] {path}: _fts5_escape already present — skipping")
        return False

    if OLD_BLOCK not in src:
        raise SystemExit(
            f"[patch] ERROR: target block not found in {path}; "
            "backend may have changed shape since this patch was written"
        )

    # Backup
    ts = time.strftime("%Y%m%d_%H%M%S")
    bak = f"{path}.pre-fts5.{ts}"
    shutil.copy2(path, bak)
    print(f"[patch] backup: {bak}")

    # Insert helper before _build_where_clause, replace text_query block
    marker_loc = src.find("def _build_where_clause(")
    if marker_loc < 0:
        raise SystemExit("[patch] could not find _build_where_clause anchor")

    new_src = src[:marker_loc] + HELPER.lstrip("\n") + src[marker_loc:]
    new_src = new_src.replace(OLD_BLOCK, NEW_BLOCK, 1)

    p.write_text(new_src, encoding="utf-8")
    print(f"[patch] {path}: patched OK")
    return True


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    patch(path)
