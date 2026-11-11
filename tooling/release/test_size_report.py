import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.release.size_report import inventory

SCRIPT = Path(__file__).with_name('size_report.py')


class SizeReportTest(unittest.TestCase):
    def test_counts_and_stable_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / 'runtime'
            package = runtime / 'server/node_modules/@scope/pkg'
            package.mkdir(parents=True)
            (runtime / 'bun').write_bytes(b'1234')
            (package / 'index.js').write_bytes(b'123')
            (runtime / 'outside').symlink_to(root, target_is_directory=True)
            app = root / 'app'
            app.write_bytes(b'12345')
            artifact = root / 'installer.zip'
            artifact.write_bytes(b'123456')
            command = [sys.executable, str(SCRIPT), '--runtime', str(runtime), '--app', str(app), '--artifact', str(artifact), '--artifact', str(artifact)]
            first = subprocess.check_output(command, text=True)
            self.assertEqual(first, subprocess.check_output(command, text=True))
            report = json.loads(first)
            self.assertEqual(report['runtime']['logical_bytes'], 7)
            self.assertEqual(report['runtime']['components']['bun'], 4)
            self.assertEqual(report['runtime']['packages']['@scope/pkg'], 3)
            self.assertEqual(report['application']['logical_bytes'], 5)
            self.assertEqual(len(report['artifacts']), 1)
            self.assertEqual(report['artifacts'][0]['bytes'], 6)

    def test_directory_scan_error_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch('tooling.release.size_report.os.scandir', side_effect=PermissionError('scan denied')):
                with self.assertRaisesRegex(PermissionError, 'scan denied'):
                    inventory(Path(tmp))

    def test_missing_input_fails(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--runtime', '/missing-study-runtime', '--app', '/missing-study-app'], capture_output=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
