"""Launch the packaged desktop executable and wait for the rendered client's health snapshot."""
from contextlib import suppress
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time

HEALTHY = b"WebView received a healthy server snapshot"


def check_webview(executable, timeout=90):
    with tempfile.TemporaryDirectory(prefix="study-macos-webview-") as temporary:
        environment = dict(os.environ, STUDY_DATABASE=str(Path(temporary) / "study.sqlite"),
                           STUDY_LOG="info", NO_COLOR="1")
        for override in ("STUDY_BUN_PATH", "STUDY_SERVER_ENTRY"):
            environment.pop(override, None)
        with subprocess.Popen(
            [executable], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, cwd=temporary, env=environment, start_new_session=True,
        ) as app:
            try:
                wait_for_snapshot(app.stdout, timeout)
            finally:
                # The disposable app and its private Bun server own this process group.
                with suppress(ProcessLookupError):
                    os.killpg(app.pid, signal.SIGKILL)


def wait_for_snapshot(output, timeout):
    deadline = time.monotonic() + timeout
    pending = b""
    with selectors.DefaultSelector() as selector:
        selector.register(output, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            chunk = os.read(output.fileno(), 8192)
            if not chunk:
                raise RuntimeError("Study closed its output without a healthy WebView")
            print(chunk.decode(errors="replace"), end="", flush=True)
            *lines, pending = (pending + chunk).split(b"\n")
            if any(line.endswith(HEALTHY) for line in lines):
                return
    raise TimeoutError(f"Study did not report a healthy WebView within {timeout} seconds")


if __name__ == "__main__":
    image = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="study-macos-image-") as mount:
        subprocess.run(
            ["hdiutil", "attach", str(image), "-readonly", "-nobrowse", "-mountpoint", mount, "-quiet"],
            check=True,
        )
        try:
            check_webview(Path(mount) / "Study.app/Contents/MacOS/study")
        finally:
            subprocess.run(["hdiutil", "detach", mount, "-quiet"], check=True)
