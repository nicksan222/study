#!/usr/bin/env bash
# Replace only the development data, while no managed app is using it.
set -euo pipefail
script_dir=$(dirname "${BASH_SOURCE[0]}")
repo=$(realpath "$script_dir/../..")
mkdir -p "$repo/target/desktop"
exec 7>"$repo/target/desktop/data.lock"
if ! flock -n 7; then
  echo "Close Study before resetting development data." >&2
  exit 1
fi

# Keep the lock throughout deletion AND seeding: a new app cannot race the seed.
rm -rf -- "$repo/target/dev-data"
export XDG_DATA_HOME="$repo/target/dev-data"
cd "$repo"
cargo run --locked -q -p study-core --features seed --example seed
