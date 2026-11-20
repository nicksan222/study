import { catalogs } from '@study/localization';
import { temporaryDirectory } from '@study/testing/resources';
import { Effect, Schedule } from 'effect';
import { remote } from 'webdriverio';

import { homeNavigation } from '../home-navigation.ts';

const executable = process.argv[2];

if (!executable) throw new Error('Pass the executable built with the desktop-e2e feature');

await using directory = await temporaryDirectory({
  prefix: 'study-desktop-e2e-',
  waitForWindowsHandles: true
});

// Reserve a free loopback port for the test-only driver.
const listener = Bun.listen({
  hostname: '127.0.0.1',
  port: 0,
  socket: { data() {} }
});

const port = listener.port;

listener.stop();

const app = Bun.spawn([executable], {
  env: {
    ...process.env,
    TAURI_WEBDRIVER_PORT: String(port),
    STUDY_DATABASE: `${directory.path}/study.sqlite`,
    XDG_DATA_HOME: `${directory.path}/xdg-data`,
    WEBVIEW2_USER_DATA_FOLDER: `${directory.path}/webview`
  },
  stdout: 'inherit',
  stderr: 'inherit'
});

try {
  await Effect.runPromise(
    Effect.tryPromise(async (signal) => {
      if (app.exitCode !== null) throw new Error(`Study exited with code ${app.exitCode}`);

      const status = await fetch(`http://127.0.0.1:${port}/status`, { signal });

      if (!status.ok) throw new Error(`WebDriver returned HTTP ${status.status}`);
    }).pipe(
      Effect.retry({ schedule: Schedule.spaced('200 millis'), while: () => app.exitCode === null }),
      Effect.timeout('30 seconds')
    )
  );

  const browser = await remote({
    hostname: '127.0.0.1',
    port,
    path: '/',
    capabilities: {},
    logLevel: 'warn'
  });

  try {
    const skip = browser.$(`aria/${catalogs.english.OnboardingSkip}`);
    const byRole = async (role: string, name: string) => {
      const element = browser.$(`aria/${name}`);

      await element.waitForDisplayed();

      if ((await element.getComputedRole()) !== role) throw new Error(`Expected ${role}: ${name}`);

      return element;
    };

    await skip.click();
    await skip.waitForDisplayed({ reverse: true });
    await homeNavigation({
      goto: async (path) => browser.url(new URL(path, await browser.getUrl()).href),
      expectPath: async (path) => {
        await browser.waitUntil(async () => new URL(await browser.getUrl()).pathname === path);
      },
      click: async (role, name) => {
        await (await byRole(role, name)).click();
      },
      expectHeading: async (name) => {
        await browser.$(`h1=${name}`).waitForDisplayed();
      }
    });
  } finally {
    // WebdriverIO throws when Close Window removes the last handle. Tauri can also
    // exit before sending the reply, so use the protocol and confirm the process exit.
    await Effect.runPromise(
      Effect.tryPromise(async (signal) => {
        const result = await fetch(`http://127.0.0.1:${port}/session/${browser.sessionId}/window`, {
          method: 'DELETE',
          signal
        }).catch(() => undefined);

        if (result && !result.ok) throw new Error(`Close Window returned HTTP ${result.status}`);

        const code = await app.exited;

        if (code !== 0) throw new Error(`Study exited with code ${code} after closing its window`);
      }).pipe(Effect.timeout('25 seconds'))
    );
  }

  console.log('Home navigation reaches Projects');
} finally {
  if (app.exitCode === null) app.kill();

  await app.exited;
}
