#!/usr/bin/env python3
"""Read Study's window geometry from sway for the small just recipes.

The calling recipe sources desktop.env first. Keep JSON traversal here, rather
than repeating nested jq/shell expressions in screenshots, clicks and recordings.
All coordinates are logical pixels; output scale converts them to physical pixels.
"""
import argparse
import json
import subprocess
import sys

# GTK keeps the Tauri window class equal to its native executable name.
APP_ID = "study"


def sway_data(kind, timeout=2.0, env=None):
    result = subprocess.run(["swaymsg", "-t", kind], check=True, capture_output=True, text=True, timeout=max(0.001, timeout), env=env)
    return json.loads(result.stdout)


def study_window(tree):
    """Search tiled and floating containers without traversing unrelated JSON fields."""
    pending = [tree]
    while pending:
        node = pending.pop()
        if node.get("app_id") == APP_ID:
            return node
        pending.extend(node.get("nodes", []))
        pending.extend(node.get("floating_nodes", []))
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("value", choices=["exists", "geometry", "position", "scale"])
    parser.add_argument("--timeout", type=float, default=2.0)
    args = parser.parse_args()
    value = args.value
    if value == "scale":
        for output in sway_data("get_outputs", args.timeout):
            if output["name"] == "HEADLESS-1":
                print(output["scale"])
                return 0
        raise ValueError("the managed HEADLESS-1 output is missing")

    window = study_window(sway_data("get_tree", args.timeout))
    if value == "exists":
        return 0 if window else 1
    if window is None:
        raise ValueError("Study has no window; run just desktop-run first")
    rect = window["rect"]
    if value == "position":
        print(rect["x"], rect["y"])
    else:
        print(f"{rect['x']},{rect['y']} {rect['width']}x{rect['height']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"desktop window: {error}", file=sys.stderr)
        raise SystemExit(1)
