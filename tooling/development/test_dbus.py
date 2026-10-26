"""The managed desktop's session bus is real, reusable, and safe to stop."""
import importlib.util
from pathlib import Path
import os
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('study_dbus', ROOT / '.devcontainer/desktop/dbus.py')
BUS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUS)


class SessionBusTests(unittest.TestCase):
    def test_real_bus_reuses_pid_exports_address_and_cleans_up(self):
        with tempfile.TemporaryDirectory(prefix='study-dbus-') as folder:
            state = Path(folder)
            env = state / 'desktop.env'
            env.write_text('export WAYLAND_DISPLAY=wayland-1\n')
            try:
                first = BUS.ensure(state, env)
                second = BUS.ensure(state, env)
                self.assertTrue(first['dbus'])
                self.assertEqual(first['pid'], second['pid'])
                self.assertEqual(first['address'], second['address'])
                self.assertIn('DBUS_SESSION_BUS_ADDRESS=', env.read_text())
                self.assertIn('WAYLAND_DISPLAY=wayland-1', env.read_text())
            finally:
                BUS.stop(state)
            self.assertFalse(BUS.status(state)['dbus'])
            self.assertFalse((state / 'dbus.pid').exists())

    def test_foreign_pid_is_not_reused_or_stopped(self):
        with tempfile.TemporaryDirectory(prefix='study-dbus-') as folder:
            state = Path(folder)
            (state / 'dbus.pid').write_text(str(os.getpid()))
            with self.assertRaisesRegex(RuntimeError, 'unrelated'):
                BUS.ensure(state)
            with self.assertRaisesRegex(RuntimeError, 'unrelated'):
                BUS.stop(state)
            os.kill(os.getpid(), 0)


if __name__ == '__main__':
    unittest.main()
