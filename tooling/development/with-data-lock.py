#!/usr/bin/env python3
"""Hold the development database's shared lifetime lock before spawning its owner."""
import fcntl
from pathlib import Path
import subprocess
import signal
import sys


def run(lock_path, command):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Development data is being reset; retry after reset-data finishes.', file=sys.stderr)
            return 73
        child = None
        stopped = []
        forwarded = False
        def forward(number, _frame):
            nonlocal forwarded
            stopped.append(number)
            if child is not None and child.poll() is None and not forwarded:
                forwarded = True
                child.send_signal(number)
        previous = {number: signal.signal(number, forward) for number in (signal.SIGINT, signal.SIGTERM)}
        try:
            if stopped: return 128 + stopped[-1]
            # The actual RPC process must retain the lock even if Cargo exits first.
            child = subprocess.Popen(command, pass_fds=(lock.fileno(),))
            if stopped and not forwarded: forward(stopped[-1], None)
            return child.wait()
        finally:
            for number, handler in previous.items(): signal.signal(number, handler)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit('usage: with-data-lock.py LOCK COMMAND [ARGS...]')
    raise SystemExit(run(Path(sys.argv[1]), sys.argv[2:]))
