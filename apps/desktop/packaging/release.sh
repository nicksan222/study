#!/usr/bin/env bash
# Release packaging, shared by `just package` and .github/workflows/release.yml.
#
#   release.sh package PLATFORM   build and sign one platform's packages into dist/
#   release.sh feed TAG           check dist/ holds every platform, then write the
#                                 latest.json updater feed and SHA256SUMS
#
# Platform keys must match cargo-packager-updater's: they are the keys of latest.json.
set -euo pipefail
# From the repository root, where Cargo and dist/ live.
cd "$(dirname "$0")/../../.."

PLATFORMS=(linux-x86_64 linux-aarch64 macos-aarch64 windows-x86_64)

# Sets target, format and suffix (the updater's package) for a platform.
platform() {
    case "$1" in
        linux-x86_64) target=x86_64-unknown-linux-gnu format=appimage suffix=.AppImage ;;
        linux-aarch64) target=aarch64-unknown-linux-gnu format=appimage suffix=.AppImage ;;
        macos-aarch64) target=aarch64-apple-darwin format=app suffix=.app.tar.gz ;;
        windows-x86_64) target=x86_64-pc-windows-msvc format=nsis suffix=.exe ;;
        *) echo "unknown platform: $1 (one of ${PLATFORMS[*]})" >&2; exit 1 ;;
    esac
}

package() {
    platform "$1"
    : "${CARGO_PACKAGER_SIGN_PRIVATE_KEY:?is required for signed packages}"
    : "${STUDY_UPDATE_PUBLIC_KEY:?is required in release binaries}"
    : "${STUDY_UPDATE_ENDPOINT:?is required in release binaries}"
    local target_dir out version config
    target_dir=${CARGO_TARGET_DIR:-target}
    out="$target_dir/packages/$1"
    version=$(cargo metadata --no-deps --format-version 1 \
        | jq -r '.packages[] | select(.name == "study") | .version')
    rm -rf "$out" && mkdir -p "$out" dist
    config=$(jq -c \
        --arg version "$version" --arg target "$target" \
        --arg bins "$target_dir/$target/release" --arg out "$out" \
        --arg identity "${APPLE_SIGNING_IDENTITY:-}" \
        '. + {version: $version, targetTriple: $target, binariesDir: $bins, outDir: $out}
         | if $identity != "" then .macos.signingIdentity = $identity else . end' \
        apps/desktop/packaging/packager.json)
    local formats=("$format")
    [[ $format == app ]] && formats=(app dmg)
    export APPIMAGE_EXTRACT_AND_RUN=1
    cargo build --locked --release -p study --target "$target"
    cargo packager --config "$config" --formats "$(IFS=,; echo "${formats[*]}")"
    # Updater signatures do not validate Apple bundle signatures. Check the distributed
    # bundles, not the executable (which can run even when Finder rejects the app).
    if [[ $format == app ]]; then
        bash apps/desktop/packaging/verify-macos.sh "$out"/*.app.tar.gz "$out"/*.dmg
    fi
    local extensions=("$suffix")
    [[ $format == app ]] && extensions+=(.dmg)
    for extension in "${extensions[@]}"; do
        local matches=("$out"/*"$extension")
        [[ ${#matches[@]} == 1 && -f ${matches[0]} ]] \
            || { echo "expected one $extension package in $out" >&2; exit 1; }
        [[ -s ${matches[0]}.sig ]] || { echo "missing signature for ${matches[0]}" >&2; exit 1; }
        cp "${matches[0]}" "dist/study-$1$extension"
        cp "${matches[0]}.sig" "dist/study-$1$extension.sig"
    done
}

feed() {
    local tag=$1 platforms='{}'
    : "${GITHUB_REPOSITORY:?is required for download links}"
    for name in "${PLATFORMS[@]}"; do
        platform "$name"
        local asset="study-$name$suffix"
        [[ -s dist/$asset && -s dist/$asset.sig ]] \
            || { echo "missing release asset or signature: $asset" >&2; exit 1; }
        if [[ $format == app ]]; then
            [[ -s dist/study-$name.dmg && -s dist/study-$name.dmg.sig ]] \
                || { echo "missing macOS installer: study-$name.dmg" >&2; exit 1; }
        fi
        platforms=$(jq -c --arg name "$name" --arg format "$format" \
            --arg url "https://github.com/$GITHUB_REPOSITORY/releases/download/$tag/$asset" \
            --rawfile signature "dist/$asset.sig" \
            '.[$name] = {url: $url, signature: ($signature | sub("\\s+$"; "")), format: $format}' \
            <<<"$platforms")
    done
    jq -n --arg version "${tag#v}" --argjson platforms "$platforms" \
        '{version: $version, platforms: $platforms}' >dist/latest.json
    (cd dist && sha256sum -- * >../SHA256SUMS && mv ../SHA256SUMS .)
}

case "${1:-}" in
    package) package "${2:?platform required}" ;;
    feed) feed "${2:?tag required}" ;;
    *) echo "usage: $0 package PLATFORM | feed TAG" >&2; exit 1 ;;
esac
