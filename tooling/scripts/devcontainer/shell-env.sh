#!/usr/bin/env sh
# Sourced by container shells. The host exports this token before container startup.
# Keep an explicitly provided GH_TOKEN; never echo the token or write it into shell rc.
if [ -z "${GH_TOKEN:-}" ]; then
  if [ -s "$HOME/.config/study-devcontainer/gh-token" ]; then
    GH_TOKEN=$(cat "$HOME/.config/study-devcontainer/gh-token")
    export GH_TOKEN
  fi
fi
