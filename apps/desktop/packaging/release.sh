#!/usr/bin/env bash
# Native Tauri packaging; tooling/release assembles signed multi-platform releases.
set -euo pipefail
cd "$(dirname "$0")/../../.."
case "${1:-}" in
  package)
    if [ "$#" -lt 2 ] || [ "$#" -gt 3 ] || { [ "$#" -eq 3 ] && [ "$3" != --unsigned ]; }; then
      echo 'usage: release.sh package PLATFORM [--unsigned]' >&2; exit 2
    fi
    node tooling/release/release.mjs build "${@:2}"
    ;;
  *) echo 'usage: release.sh package PLATFORM [--unsigned]' >&2; exit 2 ;;
esac
