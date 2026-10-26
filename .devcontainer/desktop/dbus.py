#!/usr/bin/env python3
"""Own one private session bus for this repository's headless desktop."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import time
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[2]
DEFAULT_STATE = REPO / 'target/desktop'


def address(state):
    return 'unix:path=' + quote(str(state.resolve() / 'dbus.sock'), safe='/')


def pid_from(state):
    try:
        pid = int((state / 'dbus.pid').read_text().strip())
        return pid if pid > 1 else None
    except (OSError, ValueError):
        return None


def alive(pid):
    if pid is None:
        return False
    try:
        return Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z'
    except OSError:
        return False


def owned(state, pid):
    try:
        process = Path(f'/proc/{pid}')
        command = (process / 'cmdline').read_bytes().split(b'\0')
        return process.stat().st_uid == os.getuid() and any(Path(part.decode()).name == 'dbus-daemon' for part in command if part) and f'--address={address(state)}'.encode() in command
    except OSError:
        return False


def probe(bus, timeout=2.0):
    if timeout <= 0: return False
    try:
        return subprocess.run(['dbus-send', '--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames'], env={**os.environ, 'DBUS_SESSION_BUS_ADDRESS': bus}, capture_output=True, timeout=timeout).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def status(state, timeout=2.0):
    pid = pid_from(state)
    ours = alive(pid) and owned(state, pid)
    bus = address(state)
    return {'dbus': bool(ours and probe(bus, timeout)), 'pid': pid if ours else None, 'address': bus, 'owned': bool(ours)}


@contextmanager
def locked(state):
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'dbus.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def ensure(state, env_file=None):
    with locked(state):
        pid = pid_from(state)
        if alive(pid) and not owned(state, pid):
            raise RuntimeError(f'dbus.pid names unrelated PID {pid}; left untouched')
        current = status(state)
        if not current['dbus']:
            if alive(pid):
                raise RuntimeError('managed D-Bus process is alive but not responding; inspect target/desktop/dbus.log')
            socket = state / 'dbus.sock'
            if socket.exists() and probe(address(state)):
                raise RuntimeError('unmanaged D-Bus listener occupies the desktop socket; left untouched')
            socket.unlink(missing_ok=True)
            with (state / 'dbus.log').open('wb') as log:
                result = subprocess.run(['dbus-daemon', '--session', '--fork', '--nopidfile', '--print-pid=1', f'--address={address(state)}'], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, close_fds=True, timeout=5)
            lines = (state / 'dbus.log').read_text().splitlines()
            pids = [int(line) for line in lines if line.isdecimal()]
            if result.returncode or not pids:
                raise RuntimeError('D-Bus did not start; inspect target/desktop/dbus.log')
            pid = pids[-1]
            (state / 'dbus.pid').write_text(f'{pid}\n')
            deadline = time.monotonic() + 5
            while not probe(address(state)):
                if not alive(pid) or time.monotonic() >= deadline:
                    if alive(pid) and owned(state, pid):
                        os.kill(pid, signal.SIGTERM)
                    (state / 'dbus.pid').unlink(missing_ok=True)
                    raise RuntimeError('D-Bus did not start; inspect target/desktop/dbus.log')
                time.sleep(0.05)
            current = status(state)
        if env_file is not None:
            lines = env_file.read_text().splitlines() if env_file.exists() else []
            lines = [line for line in lines if not line.startswith('export DBUS_SESSION_BUS_ADDRESS=')]
            lines.append('export DBUS_SESSION_BUS_ADDRESS=' + shlex.quote(current['address']))
            partial = env_file.with_suffix('.env.partial')
            partial.write_text('\n'.join(lines) + '\n')
            partial.replace(env_file)
        return current


def stop(state):
    with locked(state):
        pid = pid_from(state)
        if alive(pid):
            if not owned(state, pid):
                raise RuntimeError(f'dbus.pid names unrelated PID {pid}; left untouched')
            # The private daemon's session group includes only its activated services.
            if os.getpgid(pid) == pid:
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 5
            while alive(pid):
                if time.monotonic() >= deadline:
                    raise RuntimeError('managed D-Bus is still stopping')
                time.sleep(0.05)
        (state / 'dbus.pid').unlink(missing_ok=True)
        (state / 'dbus.sock').unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['ensure', 'status', 'stop'])
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--address-only', action='store_true')
    args = parser.parse_args()
    if args.action == 'stop':
        stop(args.state)
        return 0
    current = ensure(args.state, args.env_file) if args.action == 'ensure' else status(args.state)
    print(current['address'] if args.address_only else json.dumps(current))
    return 0 if current['dbus'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError) as error:
        raise SystemExit(f'desktop D-Bus: {error}')
