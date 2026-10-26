"""Exercise the shell launcher's input, data-lock, and real RPC lifetime contract."""
import fcntl
import os
import re
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'tooling/development/web.sh'


class WebTests(unittest.TestCase):
    def test_invalid_arguments_fail_before_starting_services(self):
        for args in [['--port', '0'], ['--port', '3.5'], ['--port', '99999'], ['--port'], ['wat'], ['--production', '--production']]:
            with self.subTest(args=args):
                result = subprocess.run(['bash', str(SCRIPT), *args], cwd=ROOT, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 2, result.stderr.decode())

    def test_reset_lock_prevents_startup(self):
        lock_path = ROOT / 'target/desktop/data.lock'
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = subprocess.run(['bash', str(SCRIPT)], cwd=ROOT, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 73, result.stderr.decode())

    def test_web_command_serves_real_rpc_and_releases_services_on_interrupt(self):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile() as log:
            # A separate persistent database keeps this lifetime check independent of developers' app.
            env = {**os.environ, 'STUDY_DATA_PATH': str(Path(directory) / 'study.sqlite3')}
            child = subprocess.Popen(['just', 'web', '--port', str(port)], cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
            try:
                deadline = time.monotonic() + 120
                while True:
                    try:
                        with urllib.request.urlopen(base + '/__study/health', timeout=1) as response:
                            self.assertEqual(response.status, 204)
                        break
                    except OSError:
                        if child.poll() is not None or time.monotonic() > deadline:
                            log.seek(0)
                            self.fail(log.read().decode())
                        time.sleep(.1)
                with (ROOT / 'target/desktop/data.lock').open('a') as lock:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                request = urllib.request.Request(base + '/rpc/study.v1.Study/GetAppSettings', data=b'', headers={'Content-Type': 'application/protobuf'})
                with urllib.request.urlopen(request, timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('application/protobuf', response.headers['Content-Type'])
                    self.assertTrue(response.read())
            finally:
                os.killpg(child.pid, signal.SIGINT)
                child.wait(timeout=20)
            with socket.socket() as probe:
                self.assertNotEqual(probe.connect_ex(('127.0.0.1', port)), 0)
            with (ROOT / 'target/desktop/data.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_failed_backend_does_not_leave_launcher_waiting(self):
        with tempfile.TemporaryDirectory() as directory:
            cargo = Path(directory) / 'cargo'
            cargo.write_text('#!/usr/bin/env bash\nexit 23\n')
            cargo.chmod(0o755)
            env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH']}
            result = subprocess.run(['bash', str(SCRIPT)], cwd=ROOT, env=env, capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'RPC backend exited', result.stderr)

    def test_vite_failure_stops_the_backend(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen()
            port = occupied.getsockname()[1]
            env = {**os.environ, 'STUDY_DATA_PATH': str(Path(directory) / 'study.sqlite3')}
            result = subprocess.run(['bash', str(SCRIPT), '--port', str(port)], cwd=ROOT, env=env, capture_output=True, timeout=120)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'already in use', result.stderr)
            bridge = re.search(rb'--port (\d+)', result.stderr)
            self.assertIsNotNone(bridge, result.stderr.decode())
            with socket.socket() as probe:
                self.assertNotEqual(probe.connect_ex(('127.0.0.1', int(bridge[1]))), 0)
