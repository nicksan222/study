#!/usr/bin/env python3
"""Safely trim stale Cargo build artifacts."""

from __future__ import annotations

import argparse
import math
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable

HASHED_BINARY = re.compile(r"^(?P<stem>[^.]+)-[0-9a-f]{16}$")
IGNORED_TOP_LEVEL = {"agents", "browser", "data", "desktop", "dev-data"}
BUDGET_BYTES = 1024**3


def in_container() -> bool:
    return Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()


def _has_symlink_ancestor(path: Path) -> bool:
    return any(candidate.is_symlink() for candidate in (path, *path.parents))


def target_path(repo: Path, environment: dict[str, str] | None = None, *, container: bool | None = None) -> Path:
    """Resolve Cargo's target directory, enforcing the devcontainer target."""

    environment = os.environ if environment is None else environment
    container = in_container() if container is None else container
    configured = environment.get("CARGO_TARGET_DIR")
    default = "target/devcontainer" if container else "target"
    target = Path(configured).expanduser() if configured else Path(default)
    if not target.is_absolute():
        target = repo / target
    target = target.absolute()
    required = (repo / "target" / "devcontainer").absolute()
    if container and target != required:
        raise ValueError(f"in a container CARGO_TARGET_DIR must be {required}")
    if _has_symlink_ancestor(target):
        raise ValueError(f"target directory or ancestor must not be a symlink: {target}")
    return target


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _walk_files(root: Path):
    """Walk only real entries under root; never follow symlinks."""

    if root.is_symlink():
        return
    for directory, directories, files in os.walk(root, topdown=True, followlinks=False):
        current = Path(directory)
        directories[:] = [
            name for name in directories
            if not (current == root and name in IGNORED_TOP_LEVEL)
            and not (current / name).is_symlink()
        ]
        for name in files:
            path = current / name
            if not path.is_symlink():
                yield path


def allocated_bytes(root: Path) -> int:
    """Measure allocated file blocks in the Cargo build tree only."""

    if not root.is_dir() or root.is_symlink():
        return 0
    total = 0
    for path in _walk_files(root):
        try:
            info = path.stat(follow_symlinks=False)
        except OSError:
            continue
        total += getattr(info, "st_blocks", 0) * 512 or info.st_size
    return total


def _active_target_use(root: Path) -> bool:
    """Return whether cargo/rustc/build/app has a target file open on Linux."""

    proc = Path("/proc")
    if not proc.is_dir():
        return False
    for process in proc.glob("[0-9]*"):
        try:
            executable = Path(os.readlink(process / "exe"))
        except OSError:
            continue
        name = executable.name.lower()
        tool = name in {"cargo", "rustc", "study", "app"} or name.startswith("build")
        if not tool:
            continue
        candidates = [executable]
        try:
            candidates.extend(Path(os.readlink(fd)) for fd in (process / "fd").iterdir())
        except OSError:
            pass
        if any(_inside(candidate, root) for candidate in candidates):
            return True
    return False


def _hashed_executables(root: Path):
    groups: dict[tuple[Path, str], list[Path]] = {}
    for path in _walk_files(root):
        if path.parent.name != "deps":
            continue
        try:
            mode = path.stat(follow_symlinks=False).st_mode
        except OSError:
            continue
        if not mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
            continue
        match = HASHED_BINARY.fullmatch(path.name)
        if match:
            groups.setdefault((path.parent, match.group("stem")), []).append(path)
    return groups.values()


def prune_stale(root: Path) -> int:
    """Keep the two newest hashed executables for each deps stem."""

    removed = 0
    for candidates in _hashed_executables(root):
        ordered = sorted(
            candidates,
            key=lambda path: (path.stat(follow_symlinks=False).st_mtime_ns, path.name),
            reverse=True,
        )
        for path in ordered[2:]:
            try:
                path.unlink()
                removed += 1
            except FileNotFoundError:
                pass
    return removed


def _cargo_clean(repo: Path, target: Path) -> int:
    """Clean only standard profiles in this exact Cargo target directory."""

    statuses = []
    for profile in ("dev", "release"):
        result = subprocess.run(
            ["cargo", "clean", "--target-dir", str(target), "--profile", profile],
            cwd=repo,
            check=False,
        )
        statuses.append(result.returncode)
    return max(statuses, default=0)


def trim(
    repo: Path,
    budget_gb: float,
    *,
    target: Path | None = None,
    measure: Callable[[Path], int] = allocated_bytes,
    busy: Callable[[Path], bool] = _active_target_use,
    clean: Callable[[Path, Path], int] | None = None,
) -> int:
    target = target or target_path(repo)
    if _has_symlink_ancestor(target):
        raise ValueError(f"target directory or ancestor must not be a symlink: {target}")
    if not target.is_dir():
        print(f"Cargo target does not exist: {target}")
        return 0
    budget = budget_gb * BUDGET_BYTES
    used = measure(target)
    if used <= budget:
        print(f"Cargo target is within budget: {used / BUDGET_BYTES:.2f} GiB")
        return 0
    if busy(target):
        print(f"Cargo target is over budget but active build/app use was detected: {target}")
        return 0

    removed = prune_stale(target)
    print(f"Cargo target is over budget; removed {removed} stale executable(s)")
    if measure(target) <= budget:
        return 0
    if clean is None:
        clean = _cargo_clean
    return clean(repo, target)


def positive_budget(value: str) -> float:
    try:
        result = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("budget must be a positive finite number") from exc
    if not math.isfinite(result) or result <= 0:
        raise argparse.ArgumentTypeError("budget must be a positive finite number")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Trim stale Cargo target artifacts.")
    parser.add_argument("budget_gb", nargs="?", type=positive_budget, default=40.0)
    args = parser.parse_args(argv)
    try:
        return trim(Path.cwd(), args.budget_gb)
    except (OSError, ValueError) as exc:
        print(f"trim error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

