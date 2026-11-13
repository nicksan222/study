#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo"
set -- "${1:-display}"
if [ "$1" = list ]; then
    exec bash tooling/scripts/desktop/screen.sh list
fi
bash tooling/scripts/desktop/screen.sh "$1" --validate
bash tooling/scripts/desktop/stop.sh
bash tooling/scripts/desktop/screen.sh "$1"
echo "Building and starting Study; log: target/desktop/app.log"
bash tooling/scripts/desktop/app.sh
