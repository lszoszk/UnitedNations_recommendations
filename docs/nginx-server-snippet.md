# nginx server-block edits — UHRI rate-limit

The zones in `docs/nginx-zones.conf` are useless on their own; the
server block in `/etc/nginx/sites-enabled/default` has to *invoke*
them via `limit_req` / `limit_conn` directives and the scanner-UA
block.  This file documents exactly what to add and where, with a
ready-to-apply `sed` script for the actual deployment.

Deployed live on the UHRI VM on **2026-04-24**.  Validation output
at the end.

---

## What we're adding

Four insertions inside the `server { listen 443 ... }` block:

| # | Where | What | Purpose |
|---|---|---|---|
| A | Top of server block, after `ssl_certificate_key` | `if ($uhri_ua_block = 1) { return 403; }` + `limit_conn uhri_conn 10;` | Scanner block + per-IP connection cap |
| B | Inside `location ~ ^/uhri-api/api/data/records$` | `limit_req zone=uhri_api burst=60 nodelay;` | Search hot path |
| C | Inside `location ~ ^/uhri-api/api/(feedback\|data/(full\|export\|refresh_status))$` | `limit_req zone=uhri_api_heavy burst=3 nodelay;` | Heavy bulk endpoints |
| D | Inside `location /uhri-api/` catch-all | `limit_req zone=uhri_api burst=60 nodelay;` | Everything else under `/uhri-api/` |

Mattermost and ECHR_API traffic on this VM is deliberately NOT
rate-limited — the `/` catch-all and `/echr-api/*` locations are
untouched.

---

## Prerequisites

1. **Zones file already in place** — `/etc/nginx/conf.d/uhri-zones.conf`
   should exist and `nginx -t` should already pass before you start.
   If not, scp `docs/nginx-zones.conf` there first.

2. **Make a backup outside `sites-enabled/`.**  Do NOT put the
   backup inside `/etc/nginx/sites-enabled/` — nginx globs that
   directory with `include sites-enabled/*`, so a backup file gets
   parsed as a live config and triggers a "duplicate upstream"
   error.  Keep backups in `~/` or `/root/` or `/etc/nginx/backups/`:

   ```bash
   sudo cp /etc/nginx/sites-enabled/default ~/default.bak-$(date +%Y%m%d)
   ```

---

## Apply via sed (recommended — deterministic)

```bash
# 1. Write the sed instructions to a temp file.  The quoted heredoc
#    ('SCRIPT') prevents shell $ expansion so the nginx $uhri_ua_block
#    variable survives intact.
cat > /tmp/uhri-apply.sed <<'SCRIPT'
/ssl_certificate_key \/etc\/letsencrypt\/live\/150\.254\.115\.204\/privkey\.pem;/a\
\
  # 2026-04-24: scanner UA rejection + per-IP connection cap\
  # (zones defined in /etc/nginx/conf.d/uhri-zones.conf)\
  if ($uhri_ua_block = 1) { return 403; }\
  limit_conn uhri_conn 10;
/^  location ~ \^\/uhri-api\/api\/data\/records$ {$/a\
    limit_req zone=uhri_api burst=60 nodelay;
/^  location ~ \^\/uhri-api\/api\/(feedback|data\/(full|export|refresh_status))$ {$/a\
    limit_req zone=uhri_api_heavy burst=3 nodelay;
/^  location \/uhri-api\/ {$/a\
    limit_req zone=uhri_api burst=60 nodelay;
SCRIPT

# 2. Apply
sudo sed -i -f /tmp/uhri-apply.sed /etc/nginx/sites-enabled/default

# 3. Validate
sudo nginx -t
```

If `nginx -t` fails, revert from the backup:

```bash
sudo cp ~/default.bak-$(date +%Y%m%d) /etc/nginx/sites-enabled/default
sudo nginx -t
```

If `nginx -t` passes, reload:

```bash
sudo systemctl reload nginx
```

---

## Validation

```bash
# 1. Normal request still works
curl -sk -o /dev/null -w "normal:  %{http_code}\n" \
  https://150.254.115.204/uhri-api/api/data/facets
# Expected: normal: 200

# 2. Scanner UA is blocked
curl -sk -o /dev/null -w "sqlmap:  %{http_code}\n" \
  -H "User-Agent: sqlmap/1.0" \
  https://150.254.115.204/uhri-api/api/data/facets
# Expected: sqlmap: 403

# 3. Hammer test — 100 parallel requests, rate limit kicks in
seq 100 | xargs -P20 -I{} curl -sk -o /dev/null -w "%{http_code}\n" \
  https://150.254.115.204/uhri-api/api/data/records \
  | sort | uniq -c
# Expected:
#   ~40 × 200
#   ~60 × 429   (rate-limit rejections)
```

---

## Reference: resulting file shape

After the sed applies, the top of the 443 server block looks like:

```nginx
server {
  listen 443 ssl http2;
  server_name 150.254.115.204;

  ssl_certificate /etc/letsencrypt/live/150.254.115.204/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/150.254.115.204/privkey.pem;

  # 2026-04-24: scanner UA rejection + per-IP connection cap
  # (zones defined in /etc/nginx/conf.d/uhri-zones.conf)
  if ($uhri_ua_block = 1) { return 403; }
  limit_conn uhri_conn 10;

  # (existing location blocks follow, each now prefixed with limit_req…)
```

And each affected `location` block gains a single `limit_req` line as
its first directive.

---

## Common gotchas (lessons from the live deployment)

1. **Backup inside `sites-enabled/` breaks nginx.**  We learned this
   the hard way — `default.bak-20260424` inside `sites-enabled/` was
   loaded as a second (duplicate) config by nginx's glob include,
   producing `duplicate upstream "mattermost"` errors.  Always put
   backups OUTSIDE `sites-enabled/`.

2. **`if` directive scope.**  `if` is allowed inside `server { }` and
   `location { }` but NOT at http scope (i.e. in `conf.d/*.conf`
   files, which are included inside http).  Scanner-UA rejection
   therefore has to live in the server block, not the zones file.
   The zones file uses `map` instead, which IS allowed at http scope.

3. **nginx `limit_req_status` defaults to 503.**  You probably want
   429 (Too Many Requests) — semantically correct, triggers client
   backoff instead of retry storms, doesn't get mis-cached as "origin
   down" by CDNs.  Set it in the zones file (already done in
   `docs/nginx-zones.conf`).

4. **`limit_req` is per-zone, not per-location.**  Each location that
   references `zone=uhri_api` shares the same per-IP counter.  If
   you want tighter per-endpoint limits, define additional zones.
