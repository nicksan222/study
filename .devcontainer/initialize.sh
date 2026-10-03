#!/usr/bin/env bash
# Runs on the host before the devcontainer starts. Create bind-mount sources
# even when the corresponding login is absent.
set -uo pipefail

# Keep these paths in sync with devcontainer.json.
dirs=(.claude .codex .config/gh .config/study-devcontainer)
files=(.claude.json)

for dir in "${dirs[@]}"; do
  mkdir -p "$HOME/$dir"
done
for file in "${files[@]}"; do
  if [ ! -e "$HOME/$file" ]; then
    touch "$HOME/$file"
  fi
done

# Step 2: export the existing GitHub login into a private file, never into image
# layers or command output. A failed export clears stale credentials.
# The host's gh token, for git and gh in the container: the host may keep it in a keyring the
# container can't reach. Empty when gh is missing or not logged in.
token="$HOME/.config/study-devcontainer/gh-token"
(
  umask 077
  if command -v gh >/dev/null 2>&1 && gh auth token >"$token.new" 2>/dev/null; then
    mv "$token.new" "$token"
  else
    rm -f "$token.new"
    : >"$token"
  fi
)
# Step 3: export the resolved author identity, including host includeIf rules for
# this checkout. Copying the whole host .gitconfig would import OS-specific helpers
# and signing commands that may not exist in Linux. Authentication comes from gh.
identity="$HOME/.config/study-devcontainer/git-identity"
(
  umask 077
  : >"$identity.new"
  if command -v git >/dev/null 2>&1; then
    for key in user.name user.email; do
      if value=$(git config --get "$key"); then
        git config --file "$identity.new" "$key" "$value"
      fi
    done
  fi
  mv "$identity.new" "$identity"
)
# Step 4: open the desktop viewer in the host browser once the container serves it.
# Detached, so the container starts without waiting for it.
if command -v setsid >/dev/null 2>&1; then
  setsid bash .devcontainer/open-desktop.sh >/dev/null 2>&1 </dev/null &
else
  nohup bash .devcontainer/open-desktop.sh >/dev/null 2>&1 </dev/null &
fi
exit 0
