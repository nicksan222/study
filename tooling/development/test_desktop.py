"""Geometry tests keep native screenshot and click coordinate semantics aligned."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('study_window', ROOT / '.devcontainer/desktop/window.py')
WINDOW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WINDOW)


class GeometryTests(unittest.TestCase):
    def test_tauri_window_is_found_in_floating_containers(self):
        node = {'app_id': WINDOW.APP_ID, 'rect': {'x': 40, 'y': 10, 'width': 1200, 'height': 800}}
        tree = {'nodes': [{'nodes': [], 'floating_nodes': [node]}]}
        self.assertIs(WINDOW.study_window(tree), node)

    def test_unrelated_browser_is_not_the_native_app(self):
        self.assertIsNone(WINDOW.study_window({'app_id': 'chromium', 'nodes': []}))

class StalledIpcTests(unittest.TestCase):
    def test_private_stalled_sway_socket_cannot_exceed_probe_deadline(self):
        import os
        import socket
        import subprocess
        import sys
        import tempfile
        import time
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'sway.sock')
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stalled:
                stalled.bind(path)
                stalled.listen(4)
                before = time.monotonic()
                probe = subprocess.run([sys.executable, str(ROOT / '.devcontainer/desktop/window.py'), 'exists', '--timeout', '0.15'], env={**os.environ, 'SWAYSOCK': path}, capture_output=True, timeout=1)
                self.assertNotEqual(probe.returncode, 0)
                self.assertLess(time.monotonic() - before, 0.8)
                self.assertIn('timed out', probe.stderr.decode())

    def test_status_propagates_remaining_budget_to_private_stalled_socket(self):
        import socket
        import tempfile
        import time
        spec = importlib.util.spec_from_file_location('study_desktop_status', ROOT / 'tooling/development/desktop.py')
        desktop = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(desktop)
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            (repo / 'target').mkdir()
            path = str(repo / 'sway.sock')
            (repo / 'target/desktop.env').write_text(f'export SWAYSOCK={path}\n')
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stalled:
                stalled.bind(path)
                stalled.listen(4)
                before = time.monotonic()
                result = desktop.status(timeout=0.15, repo=repo)
                self.assertLess(time.monotonic() - before, 0.8)
                self.assertFalse(result['window'])
                self.assertIn('timed out', result['diagnostic'])


if __name__ == '__main__':
    unittest.main()
