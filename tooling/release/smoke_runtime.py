"""Verify the shipped server starts, migrates a fresh database and shuts down on stdin EOF."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

source = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as temporary:
    runtime = Path(temporary) / "runtime"
    runtime.mkdir()
    node = runtime / ("node.exe" if sys.platform == "win32" else "node")
    shutil.copy2(source / node.name, node)
    shutil.copytree(source / "server", runtime / "server", symlinks=True)
    database = Path(temporary) / "study.sqlite"
    result = subprocess.run(
        [str(node), str(runtime / "server/main.js")],
        input="", text=True, capture_output=True, timeout=60, cwd=temporary,
        env=dict(os.environ, STUDY_DATABASE=str(database)),
    )
    if result.returncode:
        raise RuntimeError(result.stderr)
    ready = json.loads(result.stdout.strip())
    url = urlparse(ready["url"])
    if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port:
        raise RuntimeError(f"Invalid server readiness: {ready}")
    if not database.is_file():
        raise RuntimeError("Packaged server did not create its database")
