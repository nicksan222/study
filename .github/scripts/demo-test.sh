#!/usr/bin/env bash
# Tests for demo.sh against throwaway git repositories and a stand-in `gh`. Run from anywhere.
set -euo pipefail

script=$(realpath "$(dirname "${BASH_SOURCE[0]}")/demo.sh")
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
failures=0

check() { # check NAME EXPECTED(0|1) COMMAND...
  local name=$1 expected=$2 status=0
  shift 2
  "$@" >"$work/out" 2>&1 || status=$?
  if [ "$status" -ne "$expected" ]; then
    echo "FAIL $name: exit $status, wanted $expected"
    sed 's/^/    /' "$work/out"
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
}

expect() { # expect NAME CONDITION...: a condition on the state the last command left
  local name=$1
  shift
  if "$@"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    failures=$((failures + 1))
  fi
}

# --- A GIF header of any logical screen.
gif() { # gif FILE WIDTH HEIGHT
  local width height
  width=$(printf '%04x' "$2")
  height=$(printf '%04x' "$3")
  # Little-endian: low byte first.
  { printf 'GIF89a'; printf '%b' "\\x${width:2:2}\\x${width:0:2}\\x${height:2:2}\\x${height:0:2}"; head -c 100 /dev/zero; printf ';'; } >"$1"
}

# --- What a push needs.
new_repo() { # a repository on main with one commit, entered
  rm -rf -- "$work/repo"
  git init -q -b main "$work/repo"
  cd "$work/repo"
  git config user.name test
  git config user.email test@example.com
  mkdir -p crates/x assets docs
  echo fn >crates/x/lib.rs
  gif assets/demo.gif 1920 1080
  echo hi >docs/a.md
  git add -A
  git commit -qm base
}

new_repo
first=$(git rev-parse HEAD)
echo 'fn a' >crates/x/lib.rs
git commit -qam app
check "an app change records" 0 "$script" should-record "$first" HEAD
echo more >>docs/a.md
git commit -qam docs
app=$(git rev-parse HEAD)
echo more >>docs/a.md
echo y >>assets/demo.gif
git commit -qam "docs and the GIF"
check "docs and the GIF alone record nothing" 1 "$script" should-record "$app" HEAD
check "a push from an unknown commit records" 0 "$script" should-record 1111111111111111111111111111111111111111 HEAD
check "a new branch (all zeros) records" 0 "$script" should-record 0000000000000000000000000000000000000000 HEAD
check "touches-app sees app code" 0 "$script" touches-app "$first" HEAD
check "touches-app ignores docs and the GIF" 1 "$script" touches-app "$app" HEAD
echo 'fn b' >Cargo.toml
git add Cargo.toml
git commit -qm cargo
check "a manifest counts as app code" 0 "$script" touches-app "$app" HEAD

# --- The GIF checks.
gif "$work/t.gif" 1920 1080
check "a 1920x1080 GIF89a passes" 0 "$script" validate-gif "$work/t.gif"
gif "$work/t.gif" 1280 720
check "another size fails" 1 "$script" validate-gif "$work/t.gif"
gif "$work/t.gif" 1920 1080
head -c 20 "$work/t.gif" >"$work/short.gif"
check "a truncated GIF fails" 1 "$script" validate-gif "$work/short.gif"
sed 's/GIF89a/GIF87a/' "$work/t.gif" >"$work/old.gif"
check "GIF87a fails" 1 "$script" validate-gif "$work/old.gif"
: >"$work/empty.gif"
check "an empty file fails" 1 "$script" validate-gif "$work/empty.gif"
head -c 10000001 /dev/zero | tr '\0' 'x' >"$work/big.gif"
check "over 10 MB fails" 1 "$script" validate-gif "$work/big.gif"

# --- Publishing: a real bare origin, and a `gh` that records its calls. `pr list` prints the
# JSON in $GH_PRS, `pr create` prints a URL for pull request 9.
mkdir "$work/bin"
cat >"$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
case "$1 $2" in
  "pr list") echo "${GH_PRS:-[]}" ;;
  "pr create") echo "${GH_CREATE_URL-https://github.com/o/r/pull/9}" ;;
esac
STUB
chmod +x "$work/bin/gh"
export PATH="$work/bin:$PATH" GH_LOG="$work/gh.log" GITHUB_REPOSITORY=o/r

publish_repo() { # a clone of a bare origin whose main is the base commit; source = main
  rm -rf -- "$work/origin.git" "$work/repo"
  git init -q --bare -b main "$work/origin.git"
  new_repo
  git remote add origin "$work/origin.git"
  git push -q origin main
  SOURCE_SHA=$(git rev-parse HEAD)
  export SOURCE_SHA
  : >"$GH_LOG"
  # A valid GIF that is not the one on main: same screen, a different body.
  gif "$work/new.gif" 1920 1080
  printf 'x' | dd of="$work/new.gif" bs=1 seek=20 conv=notrunc 2>/dev/null
}
origin_ref() { git --git-dir="$work/origin.git" rev-parse --verify -q "refs/heads/$1"; }
logged() { grep -q -- "$1" "$GH_LOG"; }
not_logged() { ! grep -q -- "$1" "$GH_LOG"; }
pr() { printf '{"number":%s,"headRefName":"%s","isCrossRepository":%s}' "$1" "$2" "$3"; }

publish_repo
branch="demo/${SOURCE_SHA:0:7}"
unset GH_PRS
check "publish with no earlier PR succeeds" 0 "$script" publish "$work/new.gif"
expect "it creates the label if missing" logged '^label create demo '
expect "it opens a pull request on main from the new branch" logged "^pr create .*--base main --head $branch --title Update the demo "
expect "it labels it" logged -- '--label demo$'

expect "it closes nothing" not_logged '^pr close'
expect "it starts CI on the branch" logged "^workflow run ci.yml .*--ref $branch"
expect "it starts the demo GIF checks on the branch" logged "^workflow run demo-gif.yml .*--ref $branch"
expect "the branch is one commit on main" test "$(git --git-dir="$work/origin.git" rev-list --count "$SOURCE_SHA..refs/heads/$branch")" = 1
expect "the commit changes only the GIF" test "$(git --git-dir="$work/origin.git" diff --name-only "$SOURCE_SHA" "refs/heads/$branch")" = assets/demo.gif
expect "the commit names the source" test "$(git --git-dir="$work/origin.git" log -1 --format=%s "refs/heads/$branch")" = "Update the demo for ${SOURCE_SHA:0:7}"
expect "the commit is the bot's" test "$(git --git-dir="$work/origin.git" log -1 --format=%an "refs/heads/$branch")" = "github-actions[bot]"
expect "the body names the commit" logged "$SOURCE_SHA"

# A later merge, one earlier demo PR: the new one is created first, then the old one closed.
git checkout -q main
echo 'fn z' >crates/x/lib.rs
git commit -qam "later app change"
git push -q origin main
SOURCE_SHA=$(git rev-parse HEAD)
branch2="demo/${SOURCE_SHA:0:7}"
: >"$GH_LOG"
GH_PRS="[$(pr 5 "$branch" false)]" check "publish with one earlier PR succeeds" 0 "$script" publish "$work/new.gif"
expect "it closes the earlier one, deleting its branch" logged '^pr close 5 .*--delete-branch --comment Superseded by #9\.'
expect "it creates before it closes" test "$(grep -n -m1 '^pr create' "$GH_LOG" | cut -d: -f1)" -lt "$(grep -n -m1 '^pr close' "$GH_LOG" | cut -d: -f1)"
expect "it does not edit a PR" not_logged '^pr edit'
expect "the new branch is on the new main" test "$(git --git-dir="$work/origin.git" rev-parse "refs/heads/$branch2^")" = "$SOURCE_SHA"

publish_repo
branch="demo/${SOURCE_SHA:0:7}"
GH_PRS="[$(pr 3 demo/aaaaaaa false),$(pr 5 demo/bbbbbbb false),$(pr 9 "$branch" false)]" \
  check "publish with two earlier PRs succeeds" 0 "$script" publish "$work/new.gif"
expect "it closes the first" logged '^pr close 3 '
expect "it closes the second" logged '^pr close 5 '
expect "it does not close the new one" not_logged '^pr close 9 '

publish_repo
GH_PRS="[$(pr 4 demo/x true),$(pr 6 feature/demo-things false),$(pr 7 demo/y false)]" \
  check "publish with a fork PR and an unrelated PR succeeds" 0 "$script" publish "$work/new.gif"
expect "it leaves the fork's demo/x alone" not_logged '^pr close 4 '
expect "it leaves a PR outside the prefix alone" not_logged '^pr close 6 '
expect "it closes the same-repository demo PR" logged '^pr close 7 '

publish_repo
git commit -q --allow-empty -m "docs only"
echo more >>docs/a.md
git commit -qam "docs only"
git push -q origin main
branch="demo/${SOURCE_SHA:0:7}"
git checkout -q "$SOURCE_SHA"
check "publish when main moved by docs only succeeds" 0 "$script" publish "$work/new.gif"
expect "it still publishes the demo" test -n "$(origin_ref "$branch" || true)"
expect "it opens the pull request" logged '^pr create '

publish_repo
echo 'fn moved' >crates/x/lib.rs
git commit -qam "app change"
git push -q origin main
git checkout -q "$SOURCE_SHA"
check "publish stops when main moved by app code" 0 "$script" publish "$work/new.gif"
expect "it pushes nothing" test -z "$(origin_ref "demo/${SOURCE_SHA:0:7}" || true)"
expect "it calls no gh" test ! -s "$GH_LOG"

# The same commit again: its pull request is open, so it is reused and not created twice.
publish_repo
branch="demo/${SOURCE_SHA:0:7}"
GH_PRS="[$(pr 12 "$branch" false),$(pr 3 demo/aaaaaaa false)]" \
  check "publish of a commit with an open PR succeeds" 0 "$script" publish "$work/new.gif"
expect "it creates no second pull request" not_logged '^pr create'
expect "it closes the other one" logged '^pr close 3 .*Superseded by #12\.'
expect "it does not close the reused one" not_logged '^pr close 12 '

# A number it cannot read must not skip closing silently.
publish_repo
GH_PRS="[$(pr 3 demo/aaaaaaa false)]" GH_CREATE_URL="created" \
  check "publish fails on an unreadable pull request number" 1 "$script" publish "$work/new.gif"
expect "it closes nothing" not_logged '^pr close'

# A branch with no open pull request (a run cut off after its push) is deleted.
publish_repo
git push -q origin "HEAD:refs/heads/demo/orphan1"
git push -q origin "HEAD:refs/heads/feature/keep"
check "publish with an orphan branch succeeds" 0 "$script" publish "$work/new.gif"
expect "the orphan demo branch is deleted" test -z "$(origin_ref demo/orphan1 || true)"
expect "the new branch stays" test -n "$(origin_ref "demo/${SOURCE_SHA:0:7}" || true)"
expect "a branch outside the prefix stays" test -n "$(origin_ref feature/keep || true)"

# A commit that is not on main, as a run started by hand from a feature branch would publish.
publish_repo
git checkout -q -b feature
echo 'fn unmerged' >crates/x/lib.rs
git commit -qam "unmerged"
SOURCE_SHA=$(git rev-parse HEAD) \
  check "publish refuses a commit that is not on main" 1 "$script" publish "$work/new.gif"
expect "it pushes nothing for it" test -z "$(git --git-dir="$work/origin.git" for-each-ref refs/heads/demo/)"
expect "it calls no gh for it" test ! -s "$GH_LOG"

publish_repo
check "publish refuses a bad GIF" 1 "$script" publish "$work/short.gif"
expect "it pushes nothing for it" test -z "$(origin_ref "demo/${SOURCE_SHA:0:7}" || true)"

publish_repo
cp assets/demo.gif "$work/same.gif"
check "publish of the GIF main already has succeeds" 0 "$script" publish "$work/same.gif"
expect "it pushes nothing for it" test -z "$(origin_ref "demo/${SOURCE_SHA:0:7}" || true)"
expect "it calls no gh for it" test ! -s "$GH_LOG"

# --- check-gif-untouched: a pull request that changes the GIF, unless it is this repository's demo branch.
new_repo
base=$(git rev-parse HEAD)
git checkout -q -b change
echo 'fn q' >crates/x/lib.rs
git commit -qam "code only"
code_only=$(git rev-parse HEAD)
cp "$work/new.gif" assets/demo.gif
git commit -qam "with GIF"
with_gif=$(git rev-parse HEAD)
check "check-gif-untouched passes a pull request without the GIF" 0 "$script" check-gif-untouched pull_request o/r o/r feature/x "$base" "$code_only"
check "check-gif-untouched fails a pull request with the GIF" 1 "$script" check-gif-untouched pull_request o/r o/r feature/x "$base" "$with_gif"
out=$("$script" check-gif-untouched pull_request o/r o/r feature/x "$base" "$with_gif" || true)
expect "its message says how to fix it" test "$out" = "This pull request changes assets/demo.gif, which CI records again after each merge. Undo it: git checkout origin/main -- assets/demo.gif && git commit -m 'Leave the demo GIF to CI'"
check "check-gif-untouched passes a demo branch of this repository" 0 "$script" check-gif-untouched pull_request o/r o/r demo/abc1234 "$base" "$with_gif"
check "check-gif-untouched fails a fork's demo branch" 1 "$script" check-gif-untouched pull_request fork/r o/r demo/abc1234 "$base" "$with_gif"
check "check-gif-untouched passes on a push" 0 "$script" check-gif-untouched push "" o/r "" x x
check "check-gif-untouched passes on a dispatch" 0 "$script" check-gif-untouched workflow_dispatch "" o/r "" x x

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
echo "all passed"
