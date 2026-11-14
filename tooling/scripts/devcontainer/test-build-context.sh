#!/usr/bin/env bash
# Exercise Docker's real ignore matcher without installing tools or exporting an image.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
context="$work/context"
mkdir -p "$context"
cp "$repo/.devcontainer/Dockerfile.dockerignore" "$context/.dockerignore"
for path in mise.toml rust-toolchain.toml \
  tooling/scripts/setup/apt-packages.txt tooling/scripts/setup/system.sh \
  tooling/scripts/devcontainer/install-patchelf.sh \
  tooling/oxc-config/unlisted.ts tooling/node_modules/cache.bin \
  tooling/scripts/setup/unlisted.log target/build.bin .env; do
  mkdir -p "$(dirname "$context/$path")"
  printf 'fixture\n' > "$context/$path"
done
cat > "$context/Dockerfile" <<'DOCKERFILE'
FROM scratch
COPY . /
DOCKERFILE
docker build --output "type=local,dest=$work/output" "$context"
cat > "$work/expected" <<'FILES'
mise.toml
rust-toolchain.toml
tooling/scripts/devcontainer/install-patchelf.sh
tooling/scripts/setup/apt-packages.txt
tooling/scripts/setup/system.sh
FILES
(cd "$work/output" && find . -type f | sed 's|^./||' | LC_ALL=C sort) > "$work/actual"
diff -u "$work/expected" "$work/actual"
