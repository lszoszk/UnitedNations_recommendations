#!/usr/bin/env bash
# UHRI Dataset API — one-shot VM bootstrap (side-by-side with /echr-api/).
# Run as root on the VM.  Idempotent: re-runnable if a step fails halfway.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_URL="${REPO_URL:-}"                          # e.g. git@github.com:you/unhr-dashboard.git
DATASET_SRC="${DATASET_SRC:-}"                    # e.g. /tmp/uhri-export.json (local path on VM)
INSTALL_ROOT="/opt/uhri"
SERVICE_NAME="uhri-api"
NGINX_CONF_DIR="/etc/nginx/conf.d"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# ---- 1. System user & directories ------------------------------------------
id -u uhri >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -m -d "$INSTALL_ROOT" uhri
install -d -o uhri -g uhri "$INSTALL_ROOT/data"

# ---- 2. Code ---------------------------------------------------------------
if [ ! -d "$INSTALL_ROOT/setfit_backend" ]; then
    if [ -z "$REPO_URL" ]; then
        echo "Set REPO_URL=<git-url>  OR  rsync the repo to $INSTALL_ROOT/setfit_backend manually."
        exit 1
    fi
    sudo -u uhri git clone "$REPO_URL" "$INSTALL_ROOT/src"
    sudo -u uhri ln -sfn "$INSTALL_ROOT/src/setfit_backend" "$INSTALL_ROOT/setfit_backend"
fi

# ---- 3. Virtualenv ---------------------------------------------------------
if [ ! -x "$INSTALL_ROOT/.venv/bin/uvicorn" ]; then
    sudo -u uhri python3 -m venv "$INSTALL_ROOT/.venv"
    sudo -u uhri "$INSTALL_ROOT/.venv/bin/pip" install --upgrade pip wheel
    # Minimum set for the dataset API. Add setfit/torch/datasets only if you
    # need the labeling/classifier endpoints served from this service.
    sudo -u uhri "$INSTALL_ROOT/.venv/bin/pip" install \
        fastapi "uvicorn[standard]" pydantic numpy
fi

# ---- 4. Dataset JSON -------------------------------------------------------
if [ -n "$DATASET_SRC" ] && [ ! -f "$INSTALL_ROOT/data/uhri-export.json" ]; then
    install -o uhri -g uhri -m 0640 "$DATASET_SRC" "$INSTALL_ROOT/data/uhri-export.json"
fi

# ---- 5. systemd unit -------------------------------------------------------
install -m 0644 "$SCRIPT_DIR/uhri-api.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

# ---- 6. nginx snippet ------------------------------------------------------
if [ ! -f "$NGINX_CONF_DIR/uhri-api.conf" ]; then
    install -m 0644 "$SCRIPT_DIR/uhri-api.nginx.conf" "$NGINX_CONF_DIR/uhri-api.conf"
fi
nginx -t
systemctl reload nginx

# ---- 7. Verify -------------------------------------------------------------
sleep 2
systemctl --no-pager --full status "$SERVICE_NAME" | head -15
echo
echo "Probe:"
curl -sk "https://127.0.0.1/uhri-api/api/data/health" | head -c 400
echo
