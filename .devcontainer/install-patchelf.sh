#!/usr/bin/env bash
set -euo pipefail

# Older patchers leave Bun's DT_VERDEF pointing at the old symbol-version table.
prefix=${1:?Pass the tool installation prefix}
case "$(uname -m)" in
  aarch64) arch=aarch64; checksum=2281dd071995b449b9ce7c53c71d6d56ec3a280ae1cc66b779442abf624f7c10 ;;
  x86_64) arch=x86_64; checksum=38861b171079e440b25ac86483284f690d0ee7921dba98b0c8fe04a9b0a11667 ;;
  *) echo "Unsupported patchelf architecture: $(uname -m)" >&2; exit 1 ;;
esac

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
curl -fsSL "https://github.com/NixOS/patchelf/releases/download/0.19.3/patchelf-0.19.3-${arch}.tar.gz" -o "$temporary/patchelf.tar.gz"
printf '%s  %s\n' "$checksum" "$temporary/patchelf.tar.gz" | sha256sum --check
tar -xzf "$temporary/patchelf.tar.gz" -C "$temporary"
mkdir -p "$prefix/bin"
install -m 755 "$temporary/bin/patchelf" "$prefix/bin/patchelf"
"$prefix/bin/patchelf" --version
