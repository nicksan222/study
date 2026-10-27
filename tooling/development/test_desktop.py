"""Exercise desktop commands with isolated state and real private D-Bus daemons."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / ".devcontainer/desktop/lifecycle.py"


class DesktopTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="study-desktop-")
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.addCleanup(lambda: self.bus("stop"))

    def bus(self, action, *args):
        return subprocess.run(
            ["python3", str(HELPER), "dbus", action, "--state", str(self.state), *args],
            capture_output=True, text=True, timeout=10,
        )

    def test_real_bus_is_serialized_reused_and_releases_locks(self):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results = list(pool.map(lambda _: self.bus("ensure"), range(2)))
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        first, second = map(lambda r: json.loads(r.stdout), results)
        self.assertEqual(first["pid"], second["pid"])
        self.assertTrue(first["dbus"])
        lock = subprocess.run(["flock", "-n", str(self.state / "dbus.lock"), "true"])
        self.assertEqual(lock.returncode, 0)
        self.assertEqual(self.bus("stop").returncode, 0)
        self.assertFalse(json.loads(self.bus("status").stdout)["dbus"])

    def test_foreign_process_and_changed_identity_are_left_untouched(self):
        pidfile = self.state / "dbus.pid"
        pidfile.write_text(str(os.getpid()))
        self.assertNotEqual(self.bus("ensure").returncode, 0)
        self.assertNotEqual(self.bus("stop").returncode, 0)
        self.assertTrue(pidfile.exists())
        pidfile.unlink()
        result = self.bus("ensure")
        self.assertEqual(result.returncode, 0, result.stderr)
        identity = self.state / "dbus.identity"
        original = identity.read_text()
        try:
            identity.write_text(f"{json.loads(result.stdout)['pid']} 1")
            self.assertNotEqual(self.bus("stop").returncode, 0)
            self.assertTrue(pidfile.exists())
        finally:
            identity.write_text(original)
        self.assertEqual(self.bus("status").returncode, 0)

    def test_stale_pid_is_replaced_and_environment_export_is_atomic(self):
        (self.state / "dbus.pid").write_text("4294967295")
        env = self.state / "desktop.env"
        env.write_text("export SWAYSOCK='/tmp/a b'\n")
        result = self.bus("ensure", "--env-file", str(env), "--address-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.bus("ensure", "--env-file", str(env)).returncode, 0)
        self.assertEqual(env.read_text().count("export DBUS_SESSION_BUS_ADDRESS="), 1)
        self.assertIn("export SWAYSOCK='/tmp/a b'", env.read_text())
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)

    def test_live_unmanaged_socket_is_preserved(self):
        import socket
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(self.state / "dbus.sock"))
            server.listen()
            self.assertNotEqual(self.bus("ensure").returncode, 0)
            self.assertTrue((self.state / "dbus.sock").exists())

    def test_wait_exit_validates_targets_and_ignores_zombies(self):
        for target, success in [("2147483647", True), ("-2147483647", True), ("0", False), ("1", False), ("-1", False), ("bad", False)]:
            result = subprocess.run(["python3", str(HELPER), "wait-exit", target], capture_output=True, timeout=7)
            self.assertEqual(result.returncode == 0, success)
        child = subprocess.Popen(["true"])
        try:
            import time
            time.sleep(0.05)
            result = subprocess.run(["python3", str(HELPER), "wait-exit", str(child.pid)], capture_output=True, timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)
        finally:
            child.wait()

    def test_daemon_does_not_inherit_callers_lifecycle_lock(self):
        lock = self.state / "caller.lock"
        result = subprocess.run(
            ["bash", "-euc", 'exec 9>"$1"; flock 9; python3 "$2" dbus ensure --state "$3"', "test", str(lock), str(HELPER), str(self.state)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(subprocess.run(["flock", "-n", str(lock), "true"]).returncode, 0)

    def test_stale_pid_stop_does_not_unlink_unmanaged_socket(self):
        import socket
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(self.state / "dbus.sock"))
            server.listen()
            (self.state / "dbus.pid").write_text("4294967295")
            self.assertEqual(self.bus("stop").returncode, 0)
            self.assertTrue((self.state / "dbus.sock").exists())

    def test_missing_pidfd_support_never_signals(self):
        spec = importlib.util.spec_from_file_location("lifecycle", HELPER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        with patch.object(helper.os, "pidfd_open", None), patch.object(helper.signal, "pidfd_send_signal") as send:
            with self.assertRaisesRegex(RuntimeError, "pidfd"):
                helper.signal_bus(123, "1", "unix:path=/tmp/bus")
            send.assert_not_called()

    def test_pidfd_checks_identity_before_signalling(self):
        spec = importlib.util.spec_from_file_location("lifecycle", HELPER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        with patch.object(helper.os, "pidfd_open", return_value=9), patch.object(helper.os, "close"), patch.object(helper, "verify", side_effect=RuntimeError("identity")), patch.object(helper.signal, "pidfd_send_signal") as send:
            with self.assertRaisesRegex(RuntimeError, "identity"):
                helper.signal_bus(123, "1", "unix:path=/tmp/bus")
            send.assert_not_called()


class WindowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="study-window-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copy(ROOT / "Justfile", self.root)
        helper_dir = self.root / ".devcontainer/desktop"
        helper_dir.mkdir(parents=True)
        shutil.copy(HELPER, helper_dir)
        (self.root / "target").mkdir()
        (self.root / "target/desktop.env").write_text("export SWAYSOCK='/tmp/managed-sway'\n")
        (self.root / "bin").mkdir()
        sway = self.root / "bin/swaymsg"
        sway.write_text('#!/bin/sh\ntest "$SWAYSOCK" = /tmp/managed-sway || exit 1\ncat "$SWAY_FIXTURE"\n')
        sway.chmod(0o755)
        self.fixture = self.root / "tree.json"
        self.env = {**os.environ, "PATH": f"{self.root}/bin:{os.environ['PATH']}", "SWAY_FIXTURE": str(self.fixture)}

    def query(self, value):
        return subprocess.run(["just", "desktop-query", value], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=5)

    def test_floating_window_queries_and_missing_window(self):
        self.fixture.write_text(json.dumps({"floating_nodes": [{"app_id": "study", "rect": {"x": -40, "y": 10, "width": 1200, "height": 800}}]}))
        for key, expected in [("geometry", "-40,10 1200x800"), ("position", "-40 10"), ("exists", "")]:
            result = self.query(key)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), expected)
        self.fixture.write_text('{"nodes": []}')
        self.assertNotEqual(self.query("exists").returncode, 0)
        self.assertNotEqual(self.query("geometry").returncode, 0)

    def test_scale_requires_managed_output_and_valid_value(self):
        self.fixture.write_text('[{"name":"HEADLESS-1","scale":2}]')
        self.assertEqual(self.query("scale").stdout.strip(), "2")
        for source in ['[]', '[{"name":"HEADLESS-1","scale":0}]']:
            self.fixture.write_text(source)
            self.assertNotEqual(self.query("scale").returncode, 0)

    def test_status_is_read_only_and_wait_is_bounded(self):
        self.fixture.write_text('{"nodes": []}')
        result = subprocess.run(["just", "--quiet", "desktop-status"], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)["window"])
        self.assertFalse((self.root / "target/desktop").exists())
        for seconds in ["0", "0.1", "-1", "1e100", "garbage"]:
            result = subprocess.run(["just", "--quiet", "desktop-wait", seconds], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=2)
            self.assertNotEqual(result.returncode, 0)
        self.fixture.write_text('{"app_id":"study", "rect":{"x":0,"y":0,"width":800,"height":600}}')
        result = subprocess.run(["just", "--quiet", "desktop-wait", "0"], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["window"])

    def test_invalid_geometry_is_rejected(self):
        for rect in [{"x": 1}, {"x":0, "y":0, "width":-1, "height":2}]:
            self.fixture.write_text(json.dumps({"app_id":"study", "rect":rect}))
            for value in ["exists", "geometry", "position"]:
                self.assertNotEqual(self.query(value).returncode, 0)
