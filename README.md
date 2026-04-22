# UN Human Rights Dashboard (GitHub Pages)

Static dashboard build prepared for GitHub Pages deployment.

> **For engineering orientation see [ARCHITECTURE.md](ARCHITECTURE.md)** —
> module map, load order, cross-module surface, extraction conventions.

## What is included
- `index.html`: landing page
- `dashboard.html`: main dashboard + 16 sibling `dashboard-*.js` modules
- `sw.js`: service worker (app shell cache)
- `tests/smoke.spec.ts`: Playwright smoke tests (8 scenarios)
- `sample-data/search-4_2_2026_739_labelled.xlsx`: bundled labelled sample dataset

## Use online
- VM mode: when the site is opened from GitHub Pages, it opens in server browse mode against `https://150.254.115.204/echr-api/unhr-api` by default.
- Standard mode: open the site and upload your own Excel/JSON file.
- Demo mode (auto-load sample): open the site URL with `?demo=1`.
- Upload-only mode: add `?source=upload` to skip VM autoload.

Example:
- `https://<your-username>.github.io/<repo-name>/?demo=1`

## Deploy with GitHub Pages
1. Push this folder as its own GitHub repository.
2. In GitHub: `Settings` -> `Pages`.
3. Set source to `Deploy from a branch`.
4. Select branch `gh-pages` and folder `/ (root)`.
5. Save. Wait for the Pages URL to appear.

## Notes
- The dashboard stays static on GitHub Pages, but it now browses the large dataset through VM API endpoints by default.
- The GitHub Pages build uses these VM endpoints:
  - Dataset health: `https://150.254.115.204/echr-api/unhr-api/api/data/health`
  - Facets: `https://150.254.115.204/echr-api/unhr-api/api/data/facets`
  - Summary: `https://150.254.115.204/echr-api/unhr-api/api/data/summary`
  - Paginated records: `https://150.254.115.204/echr-api/unhr-api/api/data/records`
  - Filtered subset export for full analytics: `https://150.254.115.204/echr-api/unhr-api/api/data/export`
  - Optional full JSON fallback: `https://150.254.115.204/echr-api/unhr-api/api/data/full`
  - SetFit API: `https://150.254.115.204/echr-api/unhr-api/api/setfit`
- You can override the VM base URL later with `?vm_base=https://your-host`.
- When the VM exposes `downloaded_at` metadata, the dashboard shows that date as the dataset cutoff for users.
- Server browse mode keeps the dashboard responsive for the full 266k+ record dataset. Full charts/classifier tools are loaded only for narrowed subsets.
- SetFit now runs as a VM-backed training service with client-owned model packages:
  - training starts as an async job on the VM,
  - the resulting SetFit package is downloaded as a small ZIP to the user computer,
  - later the user can upload that ZIP again to create a temporary prediction session on the VM,
  - the package is no longer meant to be stored permanently on the server.
