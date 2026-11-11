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
if sys.platform.startswith("linux"):
    for manifest in (source / "server/node_modules").rglob("package.json"):
        libc = json.loads(manifest.read_text()).get("libc", [])
        if libc == ["musl"]:
            raise RuntimeError(f"glibc runtime includes a musl-only package: {manifest}")

with tempfile.TemporaryDirectory() as temporary:
    runtime = Path(temporary) / "runtime"
    runtime.mkdir()
    bun = runtime / ("bun.exe" if sys.platform == "win32" else "bun")
    shutil.copy2(source / bun.name, bun)
    if sys.platform == "darwin":
        shutil.copy2(source / "libsqlite3.dylib", runtime / "libsqlite3.dylib")
    shutil.copytree(source / "server", runtime / "server", symlinks=True)
    # Exercise the shipped native binding and the actual diagram worker in isolation.
    subprocess.run(
        [str(bun), "--eval", """
          const ort = require('onnxruntime-node');
          if (!ort.Tensor) throw new Error('ONNX binding did not load');
          const { Worker } = require('node:worker_threads');
          for (const [source, valid] of [['flowchart TD; A-->B', true], ['flowchart TD; A-->', false]]) {
            const result = await new Promise((resolve, reject) => {
              const worker = new Worker('./apps/server/src/platform/ai/diagram/worker.ts', { workerData: source });
              worker.once('message', resolve);
              worker.once('error', reject);
              worker.once('exit', code => { if (code) reject(new Error(`Worker exited: ${code}`)); });
            });
            if ((result === undefined) !== valid) throw new Error(`Unexpected diagram result: ${result}`);
          }
        """],
        check=True, timeout=60, cwd=runtime / "server",
    )
    database = Path(temporary) / "study.sqlite"
    result = subprocess.run(
        [str(bun), str(runtime / "server/main.js")],
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
