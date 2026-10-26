#!/usr/bin/env python3
"""Read-only desktop status and bounded readiness for automated native smoke checks."""
import argparse
import importlib.util
import json
import os
import shlex
from pathlib import Path
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]


def status(timeout=2.0, repo=REPO):
    deadline = time.monotonic() + max(0, timeout)
    remaining = lambda: max(0, deadline - time.monotonic())
    env_file = repo / 'target/desktop.env'
    def module(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        value = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(value)
        return value
    bus = module('study_dbus_status', REPO / '.devcontainer/desktop/dbus.py')
    window = module('study_window_status', REPO / '.devcontainer/desktop/window.py')
    result = {'desktop': env_file.is_file(), 'window': False, 'log': str(repo / 'target/desktop/app.log')}
    if env_file.is_file() and remaining() > 0:
        try:
            # This file is emitted by our launcher; parse its exported variables without
            # invoking another shell/IPC process whose lifetime could escape the deadline.
            exported = dict(word.split('=', 1) for word in shlex.split(env_file.read_text()) if '=' in word)
            env = {**os.environ, **exported}
            result['window'] = window.study_window(window.sway_data('get_tree', remaining(), env)) is not None
        except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            result['diagnostic'] = str(error)
    dbus = bus.status(repo / 'target/desktop', timeout=remaining())
    result.update(dbus=dbus['dbus'], dbusAddress=dbus['address'])
    pid_file = repo / 'target/desktop/app.pid'
    if pid_file.is_file():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, 0)
            result['pid'] = pid
        except (ValueError, ProcessLookupError, PermissionError):
            pass
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'wait'])
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    deadline = time.monotonic() + args.timeout
    while True:
        current = status(min(2.0, max(0, deadline - time.monotonic())))
        if args.action == 'status' or current['window']:
            print(json.dumps(current))
            return 0
        if time.monotonic() >= deadline:
            print(json.dumps(current))
            return 1
        time.sleep(min(0.25, max(0, deadline - time.monotonic())))


if __name__ == '__main__':
    raise SystemExit(main())
