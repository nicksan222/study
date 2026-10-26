"""Private lock files prove web lifetime/reset exclusion in both startup orders."""
import fcntl
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('with-data-lock.py')


class DataLockTests(unittest.TestCase):
    def test_persistent_owner_blocks_reset_until_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'data.lock'
            process = subprocess.Popen([sys.executable, str(SCRIPT), str(lock), sys.executable, '-c', 'import sys; print("ready",flush=True); sys.stdin.read()'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(), 'ready')
                with lock.open('a') as reset:
                    with self.assertRaises(BlockingIOError): fcntl.flock(reset, fcntl.LOCK_EX | fcntl.LOCK_NB)
                process.communicate('', timeout=2)
                with lock.open('a') as reset: fcntl.flock(reset, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if process.poll() is None: process.kill(); process.wait()

    def test_reset_blocks_web_start_before_any_child_touches_data(self):
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'data.lock'
            marker = Path(folder) / 'must-not-exist'
            with lock.open('a') as reset:
                fcntl.flock(reset, fcntl.LOCK_EX)
                result = subprocess.run([sys.executable, str(SCRIPT), str(lock), sys.executable, '-c', 'from pathlib import Path; import sys; Path(sys.argv[1]).touch()', str(marker)], capture_output=True, timeout=2)
                self.assertEqual(result.returncode, 73)
                self.assertFalse(marker.exists())

    def test_graceful_shutdown_keeps_lock_until_database_owner_exits(self):
        import signal
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'data.lock'
            code = 'import signal,sys,time,os; signal.signal(signal.SIGTERM,lambda *_:(os.write(1,b"stopping\\n"),time.sleep(.15),sys.exit(0))); os.write(1,b"ready\\n"); time.sleep(10)'
            process = subprocess.Popen([sys.executable, str(SCRIPT), str(lock), sys.executable, '-c', code], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(), 'ready')
                process.send_signal(signal.SIGTERM)
                self.assertEqual(process.stdout.readline().strip(), 'stopping')
                with lock.open('a') as reset:
                    with self.assertRaises(BlockingIOError): fcntl.flock(reset, fcntl.LOCK_EX | fcntl.LOCK_NB)
                process.wait(timeout=2)
                with lock.open('a') as reset: fcntl.flock(reset, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if process.poll() is None: process.kill(); process.wait()
                process.stdout.close()

    def test_rpc_descendant_keeps_lifetime_lock_if_launcher_exits_first(self):
        import os
        import signal
        import time
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'data.lock'
            code = 'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(10)"],close_fds=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid,flush=True)'
            result = subprocess.run([sys.executable, str(SCRIPT), str(lock), sys.executable, '-c', code], capture_output=True, text=True, timeout=2)
            self.assertEqual(result.returncode, 0)
            descendant = int(result.stdout.strip())
            try:
                with lock.open('a') as reset:
                    with self.assertRaises(BlockingIOError): fcntl.flock(reset, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.kill(descendant, signal.SIGTERM)
            with lock.open('a') as reset:
                deadline = time.monotonic() + 2
                while True:
                    try:
                        fcntl.flock(reset, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(.02)
