VM recovery status as of 2026-04-17 12:00 Europe/Warsaw

What was broken
- Public `https://150.254.115.204/echr-api/*` was routed by nginx to the old `search_api.py` service on `127.0.0.1:8001`.
- The UHRI dataset API was healthy on `127.0.0.1:8000`, but it was not exposed publicly under a separate path.
- GitHub Pages dashboard currently calls `https://150.254.115.204/echr-api/api/data/*`, so it was getting 404/502.

What I changed
- Patched `/home/amuvmuser/echr_rag/search_api.py` on the VM to proxy `GET /api/data/{path}` to the healthy UHRI backend on `http://127.0.0.1:8000/api/data/{path}`.
- Also changed that VM `search_api.py` startup path so metadata warm-up happens in a background thread instead of blocking startup before bind.
- The public endpoints now respond again:
  - `https://150.254.115.204/echr-api/api/data/health`
  - `https://150.254.115.204/echr-api/api/data/summary?...`
  - `https://150.254.115.204/echr-api/health`

Important VM paths
- Public old app code now patched in place:
  - `/home/amuvmuser/echr_rag/search_api.py`
- Backups created:
  - `/home/amuvmuser/echr_rag/search_api.py.bak.20260417_uhri`
- nginx live file inspected but NOT updated because `amuvmuser` has no passwordless sudo:
  - `/etc/nginx/sites-enabled/default`
- Prepared nginx draft on VM user home:
  - `/home/amuvmuser/nginx-default.uhri-fix.conf`

Still pending
- Proper separation of `uhri-api` from `echr-api` is NOT complete yet.
- Root/nginx access is required to add a real public `/uhri-api/` location and keep `/echr-api/` for the ECHR app.
- Current public recovery is a compatibility fix via `search_api.py`, not the final architecture.

Recommended next steps
1. With root or passwordless sudo, update nginx so:
   - `/uhri-api/` proxies to `127.0.0.1:8000`
   - `/echr-api/` keeps pointing to the ECHR service on `127.0.0.1:8001`
2. Reload nginx.
3. Then update the GitHub Pages frontend default VM base from `/echr-api` to `/uhri-api`.

Useful checks
- VM local:
  - `curl http://127.0.0.1:8000/api/data/health`
  - `curl http://127.0.0.1:8001/api/data/health`
- Public:
  - `curl -sk https://150.254.115.204/echr-api/api/data/health`
  - `curl -sk 'https://150.254.115.204/echr-api/api/data/summary?year_start=2006&year_end=2026'`
