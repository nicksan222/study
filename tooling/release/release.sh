#!/usr/bin/env bash
# Local preparation and single-writer, verified release assembly.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
release_temp=$(mktemp -d)
trap 'rm -rf "$release_temp"' EXIT
# Native jq on Windows otherwise emits CRLF into shell variables.
if command -v cygpath >/dev/null 2>&1; then
  jq() { command jq --binary "$@"; }
fi
fail() { echo "$*" >&2; exit 1; }
versioned() { [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || fail 'invalid release version'; }
formats() {
  case "$1" in
    linux-x86_64|linux-aarch64) INSTALL=.AppImage; UPDATE=.AppImage; UPDATER=$1; TARGET=${1/linux-/}-unknown-linux-gnu ;;
    macos-aarch64) INSTALL=.dmg; UPDATE=.app.tar.gz; UPDATER=darwin-aarch64; TARGET=aarch64-apple-darwin ;;
    windows-x86_64) INSTALL=.exe; UPDATE=.exe; UPDATER=$1; TARGET=x86_64-pc-windows-msvc ;;
    *) fail "unknown release platform: $1" ;;
  esac
}
# jq receives JSON paths from native Windows processes; coreutils use POSIX paths.
posix_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s\n' "$1"; fi; }
native_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s/%s\n' "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")"; fi; }
hash() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d ' ' -f 1; else shasum -a 256 | cut -d ' ' -f 1; fi; }
encode() { base64 | tr -d '\r\n'; }
decode() { if base64 --decode </dev/null >/dev/null 2>&1; then base64 --decode; else base64 -D; fi; }
minisign_text() {
  case "$1" in 'untrusted comment:'*) printf '%s\n' "$1" ;; *) printf '%s' "$1" | decode ;; esac
}
record() {
  if [ ! -f "$1" ] || [ -L "$1" ] || [ ! -s "$1" ]; then
    fail "release artifact is not a nonempty regular file: $2"
  fi
  jq -n --arg name "$2" --argjson size "$(wc -c < "$1" | tr -d ' ')" --arg sha256 "$(hash < "$1")" '{name:$name,size:$size,sha256:$sha256}'
}
artifact_paths() {
  printf '%s' "${STUDY_ARTIFACT_PATHS:-[]}" | jq -e 'type == "array" and all(.[]; type == "string" and (test("[\\n\\r]") | not))' >/dev/null || fail 'artifact paths must be strings without newlines'
  printf '%s' "${STUDY_ARTIFACT_PATHS:-[]}" | jq -r 'unique[]' > "$release_temp/paths"
}
one() {
  local path count=0 selected=''
  while IFS= read -r path; do
    case "$path" in *"$1") count=$((count + 1)); selected=$path ;; esac
  done < "$release_temp/paths"
  [ "$count" -ne 0 ] || fail "missing $2 $1"
  [ "$count" -eq 1 ] || fail "ambiguous $2 $1"
  posix_path "$selected"
}
validate_config() {
  versioned "$1"
  jq -e --arg version "$1" '.version == $version' "$2" >/dev/null || fail 'native configuration version does not match workspace'
  jq -e '.bundle.targets | index("nsis") != null' "$2" >/dev/null || fail 'Windows stable .exe download requires the NSIS installer'
  jq -e '.bundle.macOS.entitlements | type == "string" and length > 0' "$2" >/dev/null || fail 'macOS microphone entitlement configuration is required'
  jq -e '.bundle.createUpdaterArtifacts == true' "$2" >/dev/null || fail 'signed updater artifacts must be enabled'
}
configure() {
  local version=$1 output=$2 unsigned=${3:-} key=${STUDY_UPDATE_PUBLIC_KEY:-} endpoint=${STUDY_UPDATE_ENDPOINT:-}
  local base="$repo_root/apps/desktop/src-tauri/tauri.conf.json"
  if [ "$unsigned" = --unsigned ]; then
    jq --arg endpoint "$endpoint" '.bundle.createUpdaterArtifacts=false | .plugins.updater.pubkey="" | if $endpoint != "" then .plugins.updater.endpoints=[$endpoint] else . end' "$base" > "$release_temp/config"
  else
    [[ $key =~ ^[A-Za-z0-9+/]+={0,2}$ ]] || fail 'Tauri base64 encoded public key is required'
    printf '%s' "$key" | decode > "$release_temp/key" || fail 'Tauri base64 encoded public key is required'
    [[ $(head -n 1 "$release_temp/key") == 'untrusted comment:'* ]] || fail 'Tauri base64 encoded public key is required'
    [ -n "$endpoint" ] || endpoint=$(jq -r '.plugins.updater.endpoints[0]' "$base")
    [[ $endpoint =~ ^https://[^/?#[:space:]]+([/?#][^[:space:]]*)?$ ]] || fail 'release updater endpoint must use HTTPS'
    jq --arg key "$key" --arg endpoint "$endpoint" '.bundle.createUpdaterArtifacts=true | .plugins.updater.pubkey=$key | .plugins.updater.endpoints=[$endpoint]' "$base" > "$release_temp/config"
    validate_config "$version" "$release_temp/config"
  fi
  mkdir -p "$(dirname "$output")"
  cp "$release_temp/config" "$output"
  native_path "$output"
}
APPLE_VARIABLES=(APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID)
normalize_apple() {
  local name value certificate=${APPLE_CERTIFICATE:-} password=${APPLE_CERTIFICATE_PASSWORD:-}
  for name in "${APPLE_VARIABLES[@]}"; do
    value=${!name:-}
    if [[ ! $value =~ [^[:space:]] ]]; then unset "$name"; fi
  done
  if [[ $certificate =~ [^[:space:]] ]]; then export APPLE_CERTIFICATE_PASSWORD=$password
  else unset APPLE_CERTIFICATE_PASSWORD; fi
  if [ -z "${APPLE_CERTIFICATE:-}" ] && [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then export APPLE_SIGNING_IDENTITY=-; fi
}
prepare() {
  local platform=$1 version=$2 output=$3 installer update signature name source
  versioned "$version"; formats "$platform"; artifact_paths
  installer=$(one "$INSTALL" installer); update=$(one "$UPDATE" updater); signature=$(one "$UPDATE.sig" signature)
  [ "$(native_path "$signature")" = "$(native_path "$update.sig")" ] || fail 'signature must belong to the selected updater'
  mkdir "$release_temp/stage"
  for name in "study-$platform$INSTALL" "study-$platform$UPDATE" "study-$platform$UPDATE.sig"; do
    [ ! -e "$release_temp/stage/$name" ] || continue
    case "$name" in *.sig) source=$signature ;; *"$INSTALL") source=$installer ;; *) source=$update ;; esac
    record "$source" "$name" >> "$release_temp/records"
    cp "$source" "$release_temp/stage/$name"
  done
  jq -s --arg platform "$platform" --arg version "$version" --arg installer "study-$platform$INSTALL" --arg update "study-$platform$UPDATE" '{schemaVersion:1,platform:$platform,version:$version,installer:$installer,update:$update,signature:($update+".sig"),files:.}' "$release_temp/records" > "$release_temp/stage/manifest.json"
  mkdir -p "$output"
  cp "$release_temp/stage/"* "$output/"
}
assemble() {
  local input=$1 output=$2 version=$3 repository=$4 tag=$5 manifest platform installer update signature name source actual signed found='|' count=0
  versioned "$version"
  [ "$tag" = "v$version" ] || fail 'release tag does not match version'
  [[ $repository =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'invalid release repository'
  [ -n "${STUDY_UPDATE_PUBLIC_KEY:-}" ] || fail 'release signature public key is required'
  minisign_text "$STUDY_UPDATE_PUBLIC_KEY" > "$release_temp/public"
  mkdir "$release_temp/stage"
  printf '{}\n' > "$release_temp/platforms"
  find "$input" -type f -name manifest.json -print > "$release_temp/manifests"
  while IFS= read -r manifest; do
    platform=$(jq -er '.platform | strings' "$manifest"); formats "$platform"
    case "$found" in *"|$platform|"*) fail "duplicate platform: $platform" ;; esac
    found="$found$platform|"; count=$((count + 1))
    installer="study-$platform$INSTALL"; update="study-$platform$UPDATE"; signature="$update.sig"
    jq -e --arg version "$version" --arg installer "$installer" --arg update "$update" --arg signature "$signature" '
      .schemaVersion == 1 and .version == $version and .installer == $installer and .update == $update and .signature == $signature and
      (.files | type == "array") and ([.files[].name] | sort) == ([$installer,$update,$signature] | unique | sort)
    ' "$manifest" >/dev/null || fail 'release manifest version, artifact name or set mismatch'
    jq -r '.files[].name' "$manifest" > "$release_temp/names"
    while IFS= read -r name; do
      source="$(dirname "$manifest")/$name"
      actual=$(record "$source" "$name")
      jq -e --argjson actual "$actual" '.files[] | select(.name == $actual.name) | .size == $actual.size and .sha256 == $actual.sha256' "$manifest" >/dev/null || fail "release artifact integrity mismatch: $name"
      cp "$source" "$release_temp/stage/$name"
    done < "$release_temp/names"
    minisign_text "$(cat "$release_temp/stage/$signature")" > "$release_temp/signature"
    minisign -V -m "$release_temp/stage/$update" -p "$release_temp/public" -x "$release_temp/signature" >/dev/null 2>&1 || fail "invalid updater signature: $update"
    signed=$(encode < "$release_temp/signature")
    jq --arg platform "$UPDATER" --arg signature "$signed" --arg url "https://github.com/$repository/releases/download/$tag/$update" '.[$platform]={signature:$signature,url:$url}' "$release_temp/platforms" > "$release_temp/next"
    mv "$release_temp/next" "$release_temp/platforms"
  done < "$release_temp/manifests"
  [ "$count" -eq 4 ] || fail 'release is missing required platforms'
  jq --arg version "$version" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{version:$version,notes:("Study "+$version),pub_date:$date,platforms:.}' "$release_temp/platforms" > "$release_temp/stage/latest.json"
  mkdir -p "$output"
  cp "$release_temp/stage/"* "$output/"
}
case "${1:-}" in
  configure) shift; configure "$@" ;;
  check-config) validate_config "$2" "$repo_root/apps/desktop/src-tauri/tauri.conf.json" ;;
  prepare) shift; prepare "$@" ;;
  assemble) shift; assemble "$@" ;;
  apple-environment)
    : "${GITHUB_ENV:?GITHUB_ENV is required}"
    normalize_apple
    for name in "${APPLE_VARIABLES[@]}"; do
      if [ "${!name+x}" ]; then
        value=${!name}; delimiter=STUDY_$(printf '%s%s' "$name" "$value" | hash)
        printf '%s<<%s\n%s\n%s\n' "$name" "$delimiter" "$value" "$delimiter" >> "$GITHUB_ENV"
      fi
    done ;;
  verify-macos)
    artifact_paths; app=$(one .app 'macOS application')
    [ -d "$app" ] || fail 'macOS application bundle is missing'
    codesign --display --entitlements - --xml "$app" > "$release_temp/entitlements"
    python3 "$repo_root/tooling/release/validate_plist.py" "$release_temp/entitlements" "$app/Contents/Info.plist" ;;
  build)
    formats "$2"; cd "$repo_root"
    config=$(configure "$(jq -r .version apps/desktop/src-tauri/tauri.conf.json)" target/local-bundle-config.json "${3:-}")
    normalize_apple
    unsigned=${3:-}
    cd apps/desktop
    set -- "$repo_root/node_modules/.bin/tauri" build --config "$config" --target "$TARGET"
    if [ "$unsigned" = --unsigned ]; then set -- "$@" --no-sign; fi
    "$@" -- --locked ;;
  *) fail 'usage: release.sh configure|check-config|prepare|assemble|apple-environment|verify-macos|build' ;;
esac
