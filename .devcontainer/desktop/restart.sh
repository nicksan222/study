#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
set -- "${1:-display}"
if [ "$1" = list ]; then
    exec bash .devcontainer/desktop/screen.sh list
fi
bash .devcontainer/desktop/stop.sh
bash .devcontainer/desktop/screen.sh "$1"
echo "Building and starting Study; log: target/desktop/app.log"
bash .devcontainer/desktop/app.sh
