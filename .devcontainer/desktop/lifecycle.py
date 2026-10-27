"""Private desktop bus ownership and bounded process waiting; Linux only."""

import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote_from_bytes


def process_stat(pid):
    try:
        source = Path(f"/proc/{pid}/stat").read_text()
    except FileNotFoundError:
        return None
    end = source.rfind(") ")
    fields = source[end + 2 :].split()
    if end < 0 or len(fields) < 20:
        raise RuntimeError("malformed process stat")
    return fields


def active(target):
    if target > 0:
        fields = process_stat(target)
        return fields is not None and fields[0] not in ("Z", "X")
    return any(
        fields and fields[0] not in ("Z", "X") and int(fields[2]) == -target
        for entry in Path("/proc").iterdir()
        if entry.name.isdecimal()
        for fields in [process_stat(int(entry.name))]
    )


def wait_exit(target, budget=5):
    if not 1 < abs(target) <= 2147483647:
        raise ValueError("expected a PID or negative process-group ID greater than 1")
    deadline = time.monotonic() + budget
    while active(target):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(0.1, remaining))
    return True


def address(state):
    return "unix:path=" + quote_from_bytes(os.fsencode(state.resolve() / "dbus.sock"), safe="/_.~-")


def verify(pid, start, bus):
    proc = Path(f"/proc/{pid}")
    fields = process_stat(pid)
    args = (proc / "cmdline").read_bytes().split(b"\0")
    if (
        proc.stat().st_uid != os.getuid()
        or fields is None
        or fields[0] in ("Z", "X")
        or fields[19] != start
        or os.path.basename(args[0]) != b"dbus-daemon"
        or os.fsencode(f"--address={bus}") not in args
    ):
        raise RuntimeError("desktop D-Bus: process identity or ownership changed; left untouched")


def signal_bus(pid, start, bus):
    if not callable(getattr(os, "pidfd_open", None)) or not callable(getattr(signal, "pidfd_send_signal", None)):
        raise RuntimeError("desktop D-Bus: pidfd support unavailable; left untouched")
    fd = os.pidfd_open(pid)
    try:
        verify(pid, start, bus)
        signal.pidfd_send_signal(fd, signal.SIGTERM)
    finally:
        os.close(fd)


def recorded_pid(state):
    try:
        value = (state / "dbus.pid").read_text().strip()
    except FileNotFoundError:
        return None
    if not value.isdecimal() or not 1 < int(value) <= 4294967295:
        raise RuntimeError("desktop D-Bus: malformed dbus.pid; left untouched")
    return int(value)


def identity(state, pid):
    try:
        values = (state / "dbus.identity").read_text().split()
    except FileNotFoundError:
        values = []
    if len(values) != 2 or values[0] != str(pid) or not values[1].isdecimal():
        raise RuntimeError("desktop D-Bus: invalid process identity; left untouched")
    return values[1]


def status(state, budget=2):
    bus = address(state)
    pid = None
    try:
        candidate = recorded_pid(state)
        if candidate is not None:
            verify(candidate, identity(state, candidate), bus)
            pid = candidate
    except (OSError, RuntimeError):
        pass
    ready = False
    if pid is not None and budget > 0:
        try:
            ready = subprocess.run(
                ["dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames"],
                env={**os.environ, "DBUS_SESSION_BUS_ADDRESS": bus},
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=budget,
            ).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {"dbus": ready, "pid": pid, "address": bus, "owned": pid is not None}


@contextmanager
def locked(state):
    state.mkdir(parents=True, exist_ok=True)
    with (state / "dbus.lock").open("a") as lock:
        deadline = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("desktop D-Bus: lock timed out")
                time.sleep(0.02)
        yield


def export_env(path, bus):
    source = path.read_text() if path.exists() else ""
    lines = [line for line in source.splitlines() if line and not line.startswith("export DBUS_SESSION_BUS_ADDRESS=")]
    lines.append(f"export DBUS_SESSION_BUS_ADDRESS='{bus}'")
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temp:
        temporary = Path(temp.name)
        try:
            temp.write("\n".join(lines) + "\n")
            temp.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def remove_state(state):
    for name in ("dbus.pid", "dbus.identity", "dbus.sock"):
        (state / name).unlink(missing_ok=True)


def ensure(state, env_file=None):
    with locked(state):
        bus = address(state)
        pid = recorded_pid(state)
        if pid is not None and active(pid):
            verify(pid, identity(state, pid), bus)
            current = status(state)
            if not current["dbus"]:
                raise RuntimeError("desktop D-Bus: managed process is not responding; inspect dbus.log")
        else:
            sock = state / "dbus.sock"
            if sock.exists():
                with socket.socket(socket.AF_UNIX) as probe:
                    probe.settimeout(2)
                    try:
                        probe.connect(str(sock))
                    except (ConnectionRefusedError, FileNotFoundError):
                        pass
                    else:
                        raise RuntimeError("desktop D-Bus: unmanaged listener; left untouched")
            remove_state(state)
            with (state / "dbus.log").open("w") as log:
                child = subprocess.Popen(
                    ["dbus-daemon", "--session", "--nofork", "--nopidfile", f"--address={bus}"],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    start_new_session=True, close_fds=True,
                )
            ready = False
            old_handlers = {}
            def interrupted(signum, _frame):
                raise SystemExit(128 + signum)
            try:
                for signum in (signal.SIGINT, signal.SIGTERM):
                    old_handlers[signum] = signal.signal(signum, interrupted)
                fields = process_stat(child.pid)
                if fields is None:
                    raise RuntimeError("desktop D-Bus: daemon exited during startup")
                (state / "dbus.identity").write_text(f"{child.pid} {fields[19]}\n")
                (state / "dbus.pid").write_text(f"{child.pid}\n")
                deadline = time.monotonic() + 5
                while child.poll() is None and time.monotonic() < deadline:
                    current = status(state, min(2, deadline - time.monotonic()))
                    if current["dbus"]:
                        ready = True
                        break
                    time.sleep(0.02)
                if not ready:
                    raise RuntimeError("desktop D-Bus: did not start; inspect dbus.log")
            finally:
                for signum, handler in old_handlers.items():
                    signal.signal(signum, handler)
                if not ready:
                    child.kill()
                    child.wait()
                    remove_state(state)
        if env_file:
            export_env(env_file, bus)
        return current


def stop(state):
    with locked(state):
        pid = recorded_pid(state)
        if pid is not None and active(pid):
            start = identity(state, pid)
            signal_bus(pid, start, address(state))
            if not wait_exit(pid):
                raise RuntimeError("desktop D-Bus: managed bus is still stopping")
            (state / "dbus.sock").unlink(missing_ok=True)
        # Never remove an unowned socket: it may belong to somebody else.
        for name in ("dbus.pid", "dbus.identity"):
            (state / name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    wait = commands.add_parser("wait-exit")
    wait.add_argument("target", type=int)
    dbus = commands.add_parser("dbus")
    dbus.add_argument("action", choices=["ensure", "status", "stop"])
    dbus.add_argument("--state", type=Path, default=Path(__file__).resolve().parents[2] / "target/desktop")
    dbus.add_argument("--env-file", type=Path)
    dbus.add_argument("--address-only", action="store_true")
    args = parser.parse_args()
    if args.command == "wait-exit":
        return 0 if wait_exit(args.target) else 1
    if args.action == "stop":
        stop(args.state)
        return 0
    current = ensure(args.state, args.env_file) if args.action == "ensure" else status(args.state)
    print(current["address"] if args.address_only else json.dumps(current))
    return 0 if current["dbus"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
