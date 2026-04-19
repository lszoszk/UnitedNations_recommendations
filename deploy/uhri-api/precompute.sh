#!/bin/bash
# Precompute cache for the zero-filter UHRI endpoints.
# Pulls the current output from FastAPI (localhost:8000) and writes
# pre-gzipped JSON files under /opt/uhri/precomputed/<dataset>/.
# nginx serves those files directly for matching default-case URLs;
# filtered queries fall through to FastAPI untouched.
#
# Designed to be idempotent and safe to run concurrently.
# Max runtime ~8 s (dominated by /summary's ~5 s SQLite scan).
#
# Install:     sudo cp precompute.sh /opt/uhri/precompute.sh
#              sudo chmod 755 /opt/uhri/precompute.sh
#              sudo chown amuvmuser:amuvmuser /opt/uhri/precompute.sh
#              sudo install -d -o amuvmuser -g amuvmuser /opt/uhri/precomputed/cleaned
#              sudo install -d -o amuvmuser -g amuvmuser /opt/uhri/precomputed/raw
#
# Schedule:    /etc/cron.d/uhri-precompute:
#              */15 * * * * amuvmuser /opt/uhri/precompute.sh >> /var/log/uhri-precompute.log 2>&1

set -u  # strict, but not -e so one failed endpoint doesn't skip the rest

API_BASE='http://127.0.0.1:8000'
OUT_ROOT='/opt/uhri/precomputed'
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LOG_TAG="[precompute $TS]"

log() { echo "${LOG_TAG} $*"; }

# Endpoints to precompute as (dataset, endpoint-name, url-path) tuples.
# Only the zero-filter, dashboard-default shape. Filtered queries are proxied
# through to FastAPI by nginx.
ENDPOINTS=(
  "cleaned|summary|/api/data/summary?dataset=cleaned"
  "cleaned|facets|/api/data/facets"
  "cleaned|analytics|/api/data/analytics?dataset=cleaned"
  "cleaned|map|/api/data/map?dataset=cleaned"
  # Original UHRI (raw) dataset — smaller audience but keep warm too
  "raw|summary|/api/data/summary?dataset=raw"
  "raw|facets|/api/data/facets"
  "raw|analytics|/api/data/analytics?dataset=raw"
  "raw|map|/api/data/map?dataset=raw"
)

rc_overall=0

for tuple in "${ENDPOINTS[@]}"; do
    IFS='|' read -r dataset name path <<< "$tuple"
    dir="${OUT_ROOT}/${dataset}"
    mkdir -p "$dir"

    target="${dir}/${name}.json.gz"
    tmp="$(mktemp "${dir}/.${name}.tmp.XXXXXX")"

    start_ns=$(date +%s%N)
    http_status=$(curl -sS --max-time 30 -o "$tmp.raw" \
                       -w '%{http_code}' "${API_BASE}${path}" || echo '000')
    dur_ms=$(( ($(date +%s%N) - start_ns) / 1000000 ))

    if [[ "$http_status" != "200" ]]; then
        log "FAIL ${dataset}/${name}  status=${http_status} time=${dur_ms}ms"
        rm -f "$tmp.raw"
        rc_overall=1
        continue
    fi

    # Validate it's real JSON (and not some HTML error page).
    if ! python3 -c 'import json, sys; json.load(open(sys.argv[1]))' "$tmp.raw" \
         2>/dev/null; then
        log "FAIL ${dataset}/${name}  invalid JSON"
        rm -f "$tmp.raw"
        rc_overall=1
        continue
    fi

    raw_bytes=$(stat -c '%s' "$tmp.raw")

    # Gzip with max compression (static — compress once, serve forever).
    gzip -9 -c "$tmp.raw" > "$tmp"
    rm -f "$tmp.raw"
    gz_bytes=$(stat -c '%s' "$tmp")

    # Atomic publish
    chmod 644 "$tmp"
    mv -f "$tmp" "$target"

    pct=$(( gz_bytes * 100 / (raw_bytes + 1) ))
    log "OK   ${dataset}/${name}  raw=${raw_bytes}B gz=${gz_bytes}B (${pct}%) time=${dur_ms}ms"
done

# Write a status file for `/api/data/cache_status` observability.
status_file="${OUT_ROOT}/status.json"
tmp_status="$(mktemp "${OUT_ROOT}/.status.tmp.XXXXXX")"
python3 <<PYEOF > "$tmp_status"
import json, os, time, pathlib
root = pathlib.Path("${OUT_ROOT}")
entries = []
for gz in sorted(root.rglob("*.json.gz")):
    st = gz.stat()
    entries.append({
        "path": str(gz.relative_to(root)),
        "size_bytes": st.st_size,
        "mtime_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
        "age_seconds": int(time.time() - st.st_mtime),
    })
print(json.dumps({
    "generated_at_utc": "${TS}",
    "last_run_rc": ${rc_overall},
    "files": entries,
}, indent=2))
PYEOF
mv -f "$tmp_status" "$status_file"

log "done  files=$(ls "${OUT_ROOT}/cleaned" 2>/dev/null | wc -l)+$(ls "${OUT_ROOT}/raw" 2>/dev/null | wc -l) rc=${rc_overall}"
exit "$rc_overall"
