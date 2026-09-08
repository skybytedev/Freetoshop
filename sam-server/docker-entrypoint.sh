#!/usr/bin/env sh
# Install local Meta SAM 2 when ./sam2 is mounted at /sam2, then start the server.
set -eu

if [ -f /sam2/sam2/build_sam.py ]; then
  echo "Installing local sam2 package from /sam2..."
  SAM2_BUILD_CUDA="${SAM2_BUILD_CUDA:-0}" pip install -e /sam2 --quiet || {
    echo "Warning: pip install -e /sam2 failed; Smart Select may fall back to demo mode."
  }
else
  echo "No /sam2 mount (or missing build_sam.py). Server will use demo flood-fill unless SAM_DEMO is unset and Hub fallback works."
fi

exec "$@"
