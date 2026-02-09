# UN Human Rights Dashboard (GitHub Pages)

Static dashboard build prepared for GitHub Pages deployment.

## What is included
- `index.html`: dashboard application
- `sample-data/search-4_2_2026_739_labelled.xlsx`: bundled labelled sample dataset

## Use online
- Standard mode: open the site and upload your own Excel/JSON file.
- Demo mode (auto-load sample): open the site URL with `?demo=1`.

Example:
- `https://<your-username>.github.io/<repo-name>/?demo=1`

## Deploy with GitHub Pages
1. Push this folder as its own GitHub repository.
2. In GitHub: `Settings` -> `Pages`.
3. Set source to `Deploy from a branch`.
4. Select branch `main` and folder `/ (root)`.
5. Save. Wait for the Pages URL to appear.

## Notes
- The dashboard is fully client-side.
- SetFit backend features target `http://127.0.0.1:8765` and will remain unavailable on GitHub Pages unless that API is hosted separately.
