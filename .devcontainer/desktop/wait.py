#!/usr/bin/env python3
"""Wait for a managed PID (positive) or process group (negative) to finish.

Linux keeps exited processes as zombies until their parent reaps them. They no
longer run or hold files, but kill -0 still finds them. Ignore these finished
entries so shutdown also works in containers whose PID 1 reaps children slowly.
"""
import argparse
from pathlib import Path
import time


def is_running(target, proc=Path("/proc")):
    processes = [proc / str(target)] if target > 0 else proc.glob("[0-9]*")
    for process in processes:
        try:
            # comm is parenthesized and may itself contain spaces or parentheses.
            fields = (process / "stat").read_text().rsplit(")", 1)[1].split()
        except FileNotFoundError:
            continue  # The process exited while we were inspecting it.
        except PermissionError:
            return True  # Cannot prove shutdown; let the bounded wait report it.
        state, group = fields[0], int(fields[2])
        belongs = target > 0 or group == -target
        if belongs and state not in {"Z", "X"}:
            return True
    return False


def wait_for_exit(target, seconds=5):
    deadline = time.monotonic() + seconds
    while is_running(target):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=int)
    options = parser.parse_args()
    if abs(options.target) <= 1:
        parser.error("expected a managed PID or negative process-group ID, greater than 1")
    return 0 if wait_for_exit(options.target) else 1


if __name__ == "__main__":
    raise SystemExit(main())
