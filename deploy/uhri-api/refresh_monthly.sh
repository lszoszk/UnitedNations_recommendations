#!/bin/bash
# refresh_monthly.sh — one-shot monthly orchestrator.
# Called from /etc/cron.d/uhri-precompute at 03:00 on the 1st of each month.
# Runs as amuvmuser (docker group required).
#
# Pipeline:
#   1. API sync     — uhri_monthly_sync.py pulls OHCHR deltas into export-uhri.json
#                     and restarts the container so SQLite is rebuilt (v1).
#   2. Stage 1-3    — refresh.py regenerates uhri-export.final.jsonl with cleaned
#                     text, section headings and reclassified AnnotationType.
#   3. DB rebuild   — delete SQLite + restart container (v2) so FastAPI reads
#                     the freshly-cleaned JSONL.
#   4. FTS5 rebuild — records_fts_* against the new DB.
#   5. Precompute   — warm the zero-filter JSON cache.
#   6. Notify       — email l.szoszkiewicz@amu.edu.pl with the summary.
#
# Every step writes its own log; overall status goes to /opt/uhri/last_refresh.json.

set -u
shopt -s lastpipe

TS_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_EPOCH=$(date +%s)
LOG=/var/log/uhri-monthly.log
STATUS=/opt/uhri/last_refresh.json
DATA_DIR=/home/amuvmuser/echr-search/data
PIPELINE_DIR=/opt/uhri/pipeline
NOTIFY_TO='l.szoszkiewicz@amu.edu.pl'

declare -A STAGE_RC STAGE_SECS STAGE_SUMMARY

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG"; }

run_stage() {
    local name="$1"; shift
    local t0=$(date +%s)
    log "=== [$name] starting ==="
    local out
    out=$("$@" 2>&1)
    local rc=$?
    local dt=$(( $(date +%s) - t0 ))
    echo "$out" >> "$LOG"
    STAGE_RC["$name"]=$rc
    STAGE_SECS["$name"]=$dt
    # Collect a short summary (last non-empty line)
    STAGE_SUMMARY["$name"]=$(echo "$out" | awk 'NF { line=$0 } END { print line }')
    log "=== [$name] rc=$rc time=${dt}s ==="
    return $rc
}

# ---- STAGE 1: API sync + DB rebuild v1 --------------------------------
run_stage "api-sync" /usr/bin/python3 \
    /home/amuvmuser/echr-search/uhri_monthly_sync.py

# Even if api-sync reports non-zero (e.g. no new records, network hiccup),
# we continue — the rest of the pipeline should still run so stale data
# gets re-processed with the latest rules.

# ---- STAGE 2: Pipeline refresh ----------------------------------------
# refresh.py expects the upstream export at ./export-uhri.json — we symlink
# the data-dir copy into place inside $PIPELINE_DIR so refresh.py sees it.
mkdir -p "$PIPELINE_DIR"
ln -sf "$DATA_DIR/uhri-export.json" "$PIPELINE_DIR/export-uhri.json"

run_stage "stage1-3" /opt/uhri/.venv/bin/python3 \
    "$PIPELINE_DIR/refresh.py"

# ---- STAGE 3: publish cleaned JSONL + rebuild DB v2 ------------------
# refresh.py writes pipeline/outputs/stage2/uhri-export.final.jsonl.
# Copy into the container-visible data dir.
if [ -f "$PIPELINE_DIR/outputs/stage2/uhri-export.final.jsonl" ]; then
    cp "$PIPELINE_DIR/outputs/stage2/uhri-export.final.jsonl" \
       "$DATA_DIR/uhri-export.final.jsonl.new"
    mv "$DATA_DIR/uhri-export.final.jsonl.new" "$DATA_DIR/uhri-export.final.jsonl"
    STAGE_SUMMARY["publish-cleaned"]="OK: $(wc -l < "$DATA_DIR/uhri-export.final.jsonl") lines"
    STAGE_RC["publish-cleaned"]=0
else
    STAGE_SUMMARY["publish-cleaned"]="MISSING refresh.py output"
    STAGE_RC["publish-cleaned"]=1
fi
STAGE_SECS["publish-cleaned"]=0

# Rebuild DB v2 so FastAPI picks up the new cleaned.jsonl.
run_stage "db-rebuild" bash -c "
    rm -f $DATA_DIR/uhri-export.sqlite3 $DATA_DIR/uhri-export.sqlite3-wal $DATA_DIR/uhri-export.sqlite3-shm
    docker restart echr-search-api >/dev/null
    for i in \$(seq 1 60); do
        if curl -sf http://127.0.0.1:8000/api/data/health 2>/dev/null | grep -q '\"db_ready\":true'; then
            echo \"db_ready after \${i} * 5 s\"
            exit 0
        fi
        sleep 5
    done
    echo 'db_ready timeout (5 min)'
    exit 1
"

# ---- STAGE 4: FTS5 -----------------------------------------------------
run_stage "fts-rebuild" /opt/uhri/rebuild_fts.py

# ---- STAGE 5: precompute warm ------------------------------------------
run_stage "precompute" /opt/uhri/precompute.sh

# ---- Overall status & notification -------------------------------------
TOTAL_SECS=$(( $(date +%s) - START_EPOCH ))
FAIL_COUNT=0
for name in "${!STAGE_RC[@]}"; do
    [ "${STAGE_RC[$name]}" != "0" ] && FAIL_COUNT=$(( FAIL_COUNT + 1 ))
done

# Write machine-readable status for the dashboard
{
    echo "{"
    echo "  \"started_at\": \"$TS_START\","
    echo "  \"finished_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
    echo "  \"total_seconds\": $TOTAL_SECS,"
    echo "  \"fail_count\": $FAIL_COUNT,"
    echo "  \"stages\": {"
    first=1
    for name in api-sync stage1-3 publish-cleaned db-rebuild fts-rebuild precompute; do
        [ $first -eq 1 ] || echo "    ,"
        first=0
        summary="${STAGE_SUMMARY[$name]:-skipped}"
        # escape quotes + newlines for JSON
        summary=$(printf '%s' "$summary" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))')
        echo "    \"$name\": { \"rc\": ${STAGE_RC[$name]:-null}, \"seconds\": ${STAGE_SECS[$name]:-0}, \"summary\": $summary }"
    done
    echo "  }"
    echo "}"
} > "$STATUS".tmp && mv "$STATUS".tmp "$STATUS"

# Send email notification
SUBJECT="[UHRI] monthly refresh: $([ $FAIL_COUNT -eq 0 ] && echo OK || echo "$FAIL_COUNT FAIL") in ${TOTAL_SECS}s"
BODY=$(cat <<EOF
UHRI dashboard monthly refresh summary
======================================
Started:  $TS_START
Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Duration: ${TOTAL_SECS}s
Failures: $FAIL_COUNT

Per-stage results:
$(for name in api-sync stage1-3 publish-cleaned db-rebuild fts-rebuild precompute; do
    rc="${STAGE_RC[$name]:-skipped}"
    secs="${STAGE_SECS[$name]:-0}"
    summary="${STAGE_SUMMARY[$name]:-n/a}"
    marker=$([ "$rc" = "0" ] && echo "OK " || echo "FAIL")
    printf "  %s  %-17s  %4ss  %s\n" "$marker" "$name" "$secs" "$summary"
done)

Dataset state after refresh:
$(curl -sf http://127.0.0.1:8000/api/data/health 2>/dev/null | python3 -m json.tool 2>/dev/null | head -12)

Full log: $LOG  (lines $(wc -l < "$LOG"))
Machine status: $STATUS

--
Automated. Configure cron at /etc/cron.d/uhri-precompute.
EOF
)

# Email notification intentionally disabled — AMU SMTP rejects direct-to-MX
# from this VM (no PTR record) and the user prefers a pull-based model where
# the dashboard surfaces refresh state. See /api/data/refresh_status endpoint
# and the "Dataset freshness" card on the Methodology page. To re-enable email
# later, provision SMTP relay credentials and restore a notify_email.py call
# here referencing NOTIFY_TO="$NOTIFY_TO", SUBJECT="$SUBJECT", BODY="$BODY".
log "=== summary for dashboard consumption is in $STATUS ==="

if [ $FAIL_COUNT -eq 0 ]; then
    log "=== refresh complete: all stages OK in ${TOTAL_SECS}s ==="
    exit 0
else
    log "=== refresh complete with $FAIL_COUNT failures in ${TOTAL_SECS}s ==="
    exit 1
fi
