#!/usr/bin/env bash
# What the Demo workflow decides and does, kept in one script so it can be tested.
#
#   demo.sh touches-app BASE [HEAD]   exit 0 when BASE...HEAD changes app code
#   demo.sh should-record BEFORE AFTER  exit 0 when a push from BEFORE to AFTER needs a new demo
#   demo.sh validate-gif FILE         a GIF89a of the demo's size, at most 10 MB, not cut short
#   demo.sh publish FILE              put FILE on a new `demo/<sha>` branch, open its pull request, and close the older ones
#   demo.sh check-gif-untouched EVENT HEAD_REPO REPO HEAD_REF BASE HEAD
#                                     fail when a pull request edits the GIF and is not a demo branch of this repository
#
# Run inside a git checkout. `publish` also needs SOURCE_SHA (the `main` commit the GIF shows),
# GITHUB_REPOSITORY, and a `gh` and a `git` remote `origin` that can push.
set -euo pipefail

GIF=assets/demo.gif
WIDTH=1920
HEIGHT=1080
MAX_BYTES=10000000
PREFIX=demo/
LABEL=demo
TITLE="Update the demo"
# The workflows whose checks a pull request to `main` must pass.
CHECKS=(ci.yml demo-gif.yml)

# App code: a change here changes what the demo shows. The only list of it.
APP_PATHS=(
  apps/
  crates/
  assets/
  ":(exclude)$GIF"
  Cargo.toml
  Cargo.lock
  rust-toolchain.toml
  .devcontainer/
)

touches_app() {
  local base=$1 head=${2:-HEAD} mb
  mb=$(git merge-base "$base" "$head")
  [ -n "$(git diff --name-only "$mb" "$head" -- "${APP_PATHS[@]}")" ]
}

# A new branch (all zeros) or a history this checkout lacks cannot be compared: record.
should_record() {
  local before=$1 after=$2
  if [[ $before =~ ^0+$ ]] || ! git cat-file -e "$before^{commit}" 2>/dev/null; then
    echo "No earlier commit to compare with: recording."
    return 0
  fi
  if touches_app "$before" "$after"; then
    echo "App code changed: recording."
    return 0
  fi
  echo "No app code changed: nothing to record."
  return 1
}

validate_gif() {
  local file=$1 size header dimensions
  size=$(stat -c %s -- "$file")
  if [ "$size" -lt 1 ] || [ "$size" -gt "$MAX_BYTES" ]; then
    echo "demo.gif is $size bytes; it must be 1 to $MAX_BYTES"
    return 1
  fi
  header=$(head -c 6 -- "$file")
  if [ "$header" != GIF89a ]; then
    echo "demo.gif is not a GIF89a"
    return 1
  fi
  # A GIF ends with the trailer byte 0x3b; a cut-off download does not.
  if [ "$(tail -c 1 -- "$file" | od -An -tx1 | tr -d ' ')" != 3b ]; then
    echo "demo.gif is cut short: it has no trailer"
    return 1
  fi
  # The logical screen: two little-endian 16-bit numbers after the header.
  dimensions=$(od -An -tu2 -j6 -N4 --endian=little -- "$file" | tr -s ' ' | sed 's/^ //')
  if [ "$dimensions" != "$WIDTH $HEIGHT" ]; then
    echo "demo.gif is '$dimensions', not $WIDTH $HEIGHT"
    return 1
  fi
}

# The open pull requests from a demo branch of this repository, as "number branch" lines. A head
# branch decides, never a title, and a fork's `demo/x` is not ours.
open_demo_prs() {
  gh pr list --repo "$GITHUB_REPOSITORY" --state open --limit 200 \
    --json number,headRefName,isCrossRepository |
    jq -r --arg prefix "$PREFIX" \
      '.[] | select(.isCrossRepository | not) | select(.headRefName | startswith($prefix)) | "\(.number) \(.headRefName)"'
}

publish() {
  local file=${1:?file} source short branch main body url new number name
  source=${SOURCE_SHA:?SOURCE_SHA}
  short=${source:0:7}
  branch=$PREFIX$short
  validate_gif "$file"
  # A newer merge that changed the app has its own run, which publishes its own demo. One that
  # changed only docs leaves this demo current, and no run of its own records one.
  git fetch -q origin main
  main=$(git rev-parse FETCH_HEAD)
  if [ "$main" != "$source" ] && touches_app "$source" "$main"; then
    echo "::notice::main moved on from $short with app changes; the run for the newer commit publishes"
    return 0
  fi
  git checkout -q -B "$branch" "$source"
  cp -- "$file" "$GIF"
  git add -- "$GIF"
  if git diff --cached --quiet; then
    echo "::notice::main already has this demo: nothing to publish"
    return 0
  fi
  git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "Update the demo for $short"
  # Forced, so that running the same commit again replaces its own earlier branch.
  git push --force origin "HEAD:refs/heads/$branch"

  body="The demo as \`main\` shows it at $source.

This changes only \`$GIF\`. Each merge that changes the app opens a new demo pull request and closes the earlier ones, so this is the newest: merge it when you want the README to catch up. If \`main\` has moved, use Update branch; the checks then run as usual."
  # Running the same commit again finds its pull request open: reuse it.
  new=$(open_demo_prs | awk -v branch="$branch" '$2 == branch { print $1; exit }')
  if [ -z "$new" ]; then
    gh label create "$LABEL" --repo "$GITHUB_REPOSITORY" --color 0e8a16 \
      --description "The README demo" || true
    url=$(gh pr create --repo "$GITHUB_REPOSITORY" --base main --head "$branch" \
      --title "$TITLE" --body "$body" --label "$LABEL")
    new=${url##*/}
  fi
  if ! [[ $new =~ ^[0-9]+$ ]]; then
    echo "::error::no pull request number for $branch (got '$new'); the older demo pull requests stay open"
    return 1
  fi
  # Only now close the others, so there is never a moment without a demo pull request.
  while read -r number name; do
    [ "$number" != "$new" ] || continue
    gh pr close "$number" --repo "$GITHUB_REPOSITORY" --delete-branch --comment "Superseded by #$new."
  done < <(open_demo_prs)
  # What is left under the prefix has no open pull request: a run cut off after its push.
  git ls-remote --heads origin "refs/heads/${PREFIX}*" | cut -f2 | sed 's|^refs/heads/||' |
    while read -r name; do
      [ "$name" = "$branch" ] || git push -q origin --delete "$name"
    done
  # A push and a pull request made with the workflow's token start no checks, so ask for the
  # required ones.
  for workflow in "${CHECKS[@]}"; do
    gh workflow run "$workflow" --repo "$GITHUB_REPOSITORY" --ref "$branch"
  done
}

# Contributors do not commit the GIF: it is regenerated after the merge. Only a demo branch of
# this repository may change it.
check_gif_untouched() {
  local event=$1 head_repo=$2 repo=$3 head_ref=$4 base=$5 head=$6
  [ "$event" = pull_request ] || return 0
  if [ "$head_repo" = "$repo" ] && [[ $head_ref == "$PREFIX"* ]]; then
    return 0
  fi
  if [ -n "$(git diff --name-only "$base...$head" -- "$GIF")" ]; then
    echo "This pull request changes $GIF, which CI records again after each merge. Undo it: git checkout origin/main -- $GIF && git commit -m 'Leave the demo GIF to CI'"
    return 1
  fi
}

case "${1:-}" in
  touches-app) touches_app "${2:?base}" "${3:-HEAD}" ;;
  should-record) should_record "${2:?before}" "${3:?after}" ;;
  validate-gif) validate_gif "${2:?file}" ;;
  publish) publish "${2:?file}" ;;
  check-gif-untouched) check_gif_untouched "${2:?event}" "${3:-}" "${4:?repo}" "${5:-}" "${6:?base}" "${7:?head}" ;;
  *)
    echo "usage: demo.sh touches-app|should-record|validate-gif|publish|check-gif-untouched ..." >&2
    exit 2
    ;;
esac
