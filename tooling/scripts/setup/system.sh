#!/usr/bin/env bash
set -euo pipefail

directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mapfile -t packages < "$directory/apt-packages.txt"

case "${1:-}" in
  --image)
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      "${packages[@]}" chromium chromium-sandbox
    rm -rf /var/lib/apt/lists/*
    ;;
  '')
    if ! command -v apt-get >/dev/null; then
      echo "Native system setup requires Debian or Ubuntu." >&2
      exit 1
    fi
    # Ubuntu provides Chromium via Snap. Browser tests use Playwright's pinned browser.
    if ! command -v docker >/dev/null; then packages+=(docker.io); fi
    elevate=()
    if (( EUID != 0 )); then elevate=(sudo); fi
    "${elevate[@]}" apt-get update
    "${elevate[@]}" apt-get install -y --no-install-recommends "${packages[@]}"
    ;;
  *) exit 2 ;;
esac
