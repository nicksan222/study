#!/usr/bin/env python3
"""Follow the Tauri/Vite development watcher already managed by desktop-run.

Tauri rebuilds native changes and Vite updates React. One watcher owns that work;
this command starts it only if absent, then follows its log without a second build
loop. Ctrl+C detaches the log viewer and keeps the shared desktop/app running.
"""
import subprocess
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def main():
    subprocess.run(['bash', str(REPO / '.devcontainer/desktop/app.sh')], cwd=REPO, check=True)
    path = REPO / 'target/desktop/app.log'
    with path.open() as log:
        print(''.join(log.readlines()[-20:]), end='', flush=True)
        while True:
            line = log.readline()
            if line:
                print(line, end='', flush=True)
            else:
                time.sleep(0.25)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
