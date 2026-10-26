import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let failed = false;
function check(name, okay, detail = '') {
  console.log(`${okay ? 'ok' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!okay) failed = true;
}
for (const [command, args] of [ ['node', ['--version']], ['npm', ['--version']], ['bun', ['--version']], ['cargo', ['--version']], ['protoc', ['--version']], ['just', ['--version']] ]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  check(command, result.status === 0, result.stdout?.trim() || result.error?.message || result.stderr?.trim());
}
check('production frontend dependencies', existsSync(new URL('../../node_modules/vite/package.json', import.meta.url)));
try {
  const { chromium } = require('@playwright/test');
  check('Playwright Chromium', existsSync(chromium.executablePath()), chromium.executablePath());
} catch (error) { check('Playwright Chromium', false, error.message); }
if (process.platform === 'linux') {
  const native = spawnSync('pkg-config', ['--exists', 'gtk+-3.0', 'webkit2gtk-4.1', 'libsoup-3.0']);
  check('GTK3 / WebKitGTK 4.1 / libsoup3', native.status === 0);
  for (const command of ['dbus-daemon', 'dbus-send', 'sway', 'grim', 'wtype', 'wf-recorder']) {
    check(command, spawnSync('which', [command], { stdio: 'ignore' }).status === 0);
  }
  const status = spawnSync('python3', ['tooling/development/desktop.py', 'status'], { encoding: 'utf8' });
  if (status.status === 0) {
    const desktop = JSON.parse(status.stdout);
    console.log(`desktop: ${desktop.window ? 'Study window ready' : 'no Study window'}; D-Bus: ${desktop.dbus ? 'ready' : 'not started'}`);
    const compositor = spawnSync('bash', ['-c', '. target/desktop.env && swaymsg -t get_version >/dev/null 2>&1'], { stdio: 'ignore', timeout: 2000 });
    if (compositor.status === 0) check('managed desktop D-Bus session', desktop.dbus, desktop.dbusAddress);
  } else check('desktop status', false, status.stderr);
}
process.exitCode = failed ? 1 : 0;
