"""The packaged speech probe must distinguish initialization from model failures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class SpeechRuntimeSmokeTests(unittest.TestCase):
    def smoke(self, speech_result, speech_exit):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            (runtime / "licenses").mkdir()
            for name in ("NOTICE", "LICENSE-MIT", "LICENSE-APACHE", "LICENSE-T3CODE"):
                (runtime / "licenses" / name).write_text("license")
            (runtime / "server/node_modules").mkdir(parents=True)
            (runtime / "libsqlite3.dylib").write_bytes(b"fixture")
            (runtime / "bun").write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
if sys.argv[1].endswith('worker.ts'):
    print(os.environ['TEST_SPEECH_RESULT'])
    sys.exit(int(os.environ['TEST_SPEECH_EXIT']))
pathlib.Path(os.environ['STUDY_DATABASE']).touch()
print(json.dumps({'url': 'http://127.0.0.1:12345'}))
""")
            (runtime / "bun").chmod(0o755)
            return subprocess.run(
                [sys.executable, str(ROOT / "tooling/scripts/release/smoke_runtime.py"), str(runtime)],
                text=True, capture_output=True,
                env=dict(os.environ, TEST_SPEECH_RESULT=json.dumps(speech_result),
                         TEST_SPEECH_EXIT=str(speech_exit)),
            )

    @unittest.skipIf(sys.platform == 'win32', 'Fixture uses a POSIX executable script')
    def test_backend_failure_cannot_pass_as_missing_model(self):
        result = self.smoke({"kind": "model_unavailable"}, 1)
        self.assertNotEqual(result.returncode, 0)

    @unittest.skipIf(sys.platform == 'win32', 'Fixture uses a POSIX executable script')
    def test_verified_native_initialization_passes_without_models(self):
        result = self.smoke({"initialized": True}, 0)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
