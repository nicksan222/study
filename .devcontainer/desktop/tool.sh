#!/usr/bin/env bash
# Top-level commands build before taking locks; nested commands reuse that launch copy.
if [[ -n ${STUDY_DEV_TOOL:-} ]]; then
  study_dev=$STUDY_DEV_TOOL
else
  study_dev_root=$(realpath "$(dirname "${BASH_SOURCE[0]}")/../..")
  study_dev_artifact=$(cargo build --locked -q --manifest-path "$study_dev_root/Cargo.toml" -p study-dev --message-format=json-render-diagnostics |
    jq -r 'select(.reason == "compiler-artifact" and .target.name == "study-dev") | .executable // empty')
  # Cargo trimming must not remove the probe between app launch and readiness.
  study_dev=$(
    set -euo pipefail
    study_dev_dir="$study_dev_root/target/desktop"
    mkdir -p "$study_dev_dir"
    study_dev_partial=$(mktemp "$study_dev_dir/study-dev.XXXXXX")
    trap 'rm -f -- "$study_dev_partial"' EXIT
    install -m 755 -- "$study_dev_artifact" "$study_dev_partial"
    mv -fT -- "$study_dev_partial" "$study_dev_dir/study-dev"
    printf '%s\n' "$study_dev_dir/study-dev"
  )
fi
if [[ ! -f "$study_dev" || ! -x "$study_dev" ]]; then
  echo 'Prepared study-dev executable is missing; retry the top-level desktop command.' >&2
  exit 1
fi
