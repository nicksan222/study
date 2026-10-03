#!/usr/bin/env python3
"""Rebuild and restart Study on the desktop whenever its sources change (`just desktop-watch`).

Polls file modification times, so it needs nothing beyond Python. Each change waits
for edits to settle, builds while the old app keeps running, and only then swaps the
app: a broken build leaves the last good one on screen. The desktop and viewer stay up.
"""

import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DESKTOP = REPO / ".devcontainer/desktop"
# Everything that feeds the app binary: sources, assets, migrations and manifests.
WATCHED = [REPO / "apps", REPO / "crates", REPO / "Cargo.toml", REPO / "Cargo.lock"]
SETTLE = 0.5


def snapshot():
    """Map each watched file to its modification time."""
    files = {}
    for root in WATCHED:
        paths = root.rglob("*") if root.is_dir() else [root]
        for path in paths:
            try:
                if path.is_file():
                    files[path] = path.stat().st_mtime_ns
            except OSError:
                pass  # deleted while scanning; the next snapshot sees it
    return files


def changed_since(before):
    """Wait until the tree differs from `before`, then until edits stop."""
    current = snapshot()
    while current == before:
        time.sleep(1)
        current = snapshot()
    while True:
        time.sleep(SETTLE)
        settled = snapshot()
        if settled == current:
            return settled
        current = settled


def run(*command):
    return subprocess.run(command, cwd=REPO).returncode == 0


def restart():
    print("watch: building", flush=True)
    if not run("cargo", "build", "--locked", "-p", "study"):
        print("watch: build failed; the running app is unchanged", flush=True)
        return
    if run("bash", str(DESKTOP / "stop.sh"), "--app") and run("bash", str(DESKTOP / "app.sh")):
        print("watch: restarted", flush=True)


def main():
    if not (REPO / "target/desktop.env").is_file():
        sys.exit("No desktop: run just desktop")
    state = snapshot()
    # Start the app if it is not running yet; app.sh does nothing when it is.
    run("bash", str(DESKTOP / "app.sh"))
    print("watch: watching apps/, crates/ and the manifests; Ctrl+C stops", flush=True)
    while True:
        state = changed_since(state)
        restart()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
