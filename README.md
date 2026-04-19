# UHRI VM deploy artifacts

This **`deploy`** branch (orphan, no parent) holds the operational configuration
and deploy scripts for the VM at `150.254.115.204`. It is deliberately separate
from:

- `gh-pages` — the public dashboard (`lszoszk.github.io/UnitedNations_recommendations/`)
- `main`    — legacy / upstream project snapshots

## Contents

| Path | What it is |
|---|---|
| `deploy/DEPLOY_2026-04-17.md` | End-to-end deploy checklist for the FastAPI backend |
| `deploy/uhri-api/quickstart.sh` | One-shot bootstrap for the service unit + nginx |
| `deploy/uhri-api/uhri-api.service` | systemd unit (runs uvicorn on :8000, 3 workers) |
| `deploy/uhri-api/uhri-api.nginx.conf` | Reference nginx snippet for `/uhri-api/` |
| `deploy/uhri-api/uhri-api.perf.conf` | Tier 1 perf overlay (gzip + Cache-Control) — documentation only; values are folded into `sites-enabled-default.live.conf` |
| `deploy/uhri-api/precompute.sh` | Tier 2: curls the 4 zero-filter endpoints on localhost and writes `.json.gz` to `/opt/uhri/precomputed/` |
| `deploy/uhri-api/uhri-precompute.cron` | cron.d entry — refresh precompute every 15 min + after monthly UHRI refresh |
| `deploy/uhri-api/nginx.conf.live.conf` | **Snapshot** of `/etc/nginx/nginx.conf` on the VM |
| `deploy/uhri-api/sites-enabled-default.live.conf` | **Snapshot** of `/etc/nginx/sites-enabled/default` on the VM |
| `VM_RECOVERY_2026-04-17.md` | Incident-recovery notes |

## Tiers deployed

- **Tier 1** (2026-04-19): nginx gzip for JSON + Cache-Control / X-Cache-Policy headers + preconnect in `dashboard2.html`
- **Tier 2** (2026-04-19): static precompute of `/summary, /facets, /analytics, /map` via `map $args → try_files → @uhri_upstream`. `/summary` latency dropped from 5032 ms to ~7 ms on the VM, ~60 ms over internet.

## Quick VM-side ops

```bash
# Refresh precompute manually
ssh amuvmuser@150.254.115.204 /opt/uhri/precompute.sh

# Inspect precompute status
ssh amuvmuser@150.254.115.204 cat /opt/uhri/precomputed/status.json

# Tail refresh log
ssh amuvmuser@150.254.115.204 tail -50 /var/log/uhri-precompute.log

# Verify nginx is serving precompute
curl -sk https://150.254.115.204/uhri-api/api/data/summary?dataset=cleaned \
     -H "Accept-Encoding: gzip" -I | grep -iE 'x-cache'
# → expect: x-cache-status: precompute-hit
```

## Important caveats

- `sites-enabled/default` on the VM is a **regular file, not a symlink** to
  `sites-available/default`. Edits must target `sites-enabled/default` directly.
- The `.live.conf` snapshots were captured 2026-04-19 after deploy. If someone
  edits the VM manually, this branch drifts. Refresh via:
  ```bash
  scp amuvmuser@150.254.115.204:/etc/nginx/nginx.conf                   deploy/uhri-api/nginx.conf.live.conf
  scp amuvmuser@150.254.115.204:/etc/nginx/sites-enabled/default        deploy/uhri-api/sites-enabled-default.live.conf
  ```
