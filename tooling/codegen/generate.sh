#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT
check=false

if [[ $# -eq 1 && "$1" == "--check" ]]; then
  check=true
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

protoc \
  -I "$root/crates/study-rpc/proto" \
  "--plugin=protoc-gen-es=$root/node_modules/.bin/protoc-gen-es" \
  "--es_out=$temporary" \
  --es_opt=target=ts,import_extension=none \
  study/v1/study.proto

mkdir -p -- "$temporary/apps/desktop/src/generated"
node "$root/tooling/codegen/localization.ts" > "$temporary/apps/desktop/src/generated/catalog.ts"

outputs=(
  "apps/desktop/src/generated/study_pb.ts"
  "apps/desktop/src/generated/catalog.ts"
)
for path in "${outputs[@]}"; do
  if [[ "$path" == "apps/desktop/src/generated/catalog.ts" ]]; then
    generated="$temporary/apps/desktop/src/generated/catalog.ts"
  else
    generated="$temporary/study/v1/study_pb.ts"
  fi
  destination="$root/$path"
  if $check; then
    if ! cmp -s -- "$generated" "$destination"; then
      echo "Stale generated file: $path; run just gen-protocol" >&2
      exit 1
    fi
  else
    mkdir -p -- "$(dirname -- "$destination")"
    cp -- "$generated" "$destination"
  fi
done
