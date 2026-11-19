"""Exercise the release gate without requiring a graphical session."""
from pathlib import Path
import sys
import tempfile
import unittest

from smoke_macos_webview import check_webview


@unittest.skipIf(sys.platform == "win32", "The macOS launch helper requires POSIX pipes")
class MacOSWebViewSmokeTests(unittest.TestCase):
    def run_app(self, code, timeout=5):
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "study"
            executable.write_text(f"#!{sys.executable}\n{code}\n")
            executable.chmod(0o755)
            check_webview(executable, timeout)

    def test_webview_health_snapshot_passes(self):
        self.run_app("""
import os
from pathlib import Path
import signal

assert not Path(os.environ['STUDY_DATABASE']).exists()
print('INFO study_desktop: WebView received a healthy server snapshot', flush=True)
signal.pause()
""")

    def test_native_startup_without_webview_health_fails(self):
        with self.assertRaisesRegex(RuntimeError, "without a healthy WebView"):
            self.run_app("print('writing the diagnostic log', flush=True)")

    def test_unresponsive_webview_fails_with_a_deadline(self):
        with self.assertRaisesRegex(TimeoutError, "healthy WebView"):
            self.run_app("import signal; signal.pause()", timeout=0.1)
