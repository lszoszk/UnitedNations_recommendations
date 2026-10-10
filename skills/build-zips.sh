#!/bin/sh
# Rebuild the per-skill zips served from GitHub Pages. Run after editing any SKILL.md.
cd "$(dirname "$0")" || exit 1
for d in uhri-plus*/; do
  n=${d%/}
  rm -f "$n.zip"
  zip -qr "$n.zip" "$n" -x '*.DS_Store'
done
ls -1 ./*.zip
