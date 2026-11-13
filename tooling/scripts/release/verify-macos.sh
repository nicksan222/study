#!/usr/bin/env bash
# Verify the bundles users receive, including the updater archive. An ad-hoc signature
# is valid without an Apple account; Gatekeeper still needs the user's Open Anyway approval.
set -euo pipefail
[[ $# == 2 ]] || { echo "usage: $0 APP.tar.gz INSTALLER.dmg" >&2; exit 1; }
work=$(mktemp -d)
mounted=false
cleanup() {
    if [[ $mounted == true ]]; then
        hdiutil detach "$work/mount" -quiet
    fi
    rm -rf "$work"
}
trap cleanup EXIT

verify() {
    local apps=("$1"/*.app)
    [[ ${#apps[@]} == 1 && -d ${apps[0]} ]] \
        || { echo "expected one app bundle in $1" >&2; exit 1; }
    codesign --verify --deep --strict --verbose=2 "${apps[0]}"
}

mkdir "$work/archive" "$work/mount"
tar -xzf "$1" -C "$work/archive"
verify "$work/archive"
hdiutil attach "$2" -readonly -nobrowse -mountpoint "$work/mount" -quiet
mounted=true
verify "$work/mount"
