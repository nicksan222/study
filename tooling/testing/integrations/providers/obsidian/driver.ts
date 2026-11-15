/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Controls an isolated Obsidian renderer over local DevTools transport.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Starts the real application and creates vault fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The driver touches only its isolated profile and test owned vault directory.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { connectDevTools } from '#tooling/testing/integrations/devtools';
import { fs, path, run } from '#tooling/testing/integrations/filesystem';
import { requireIntegrationContainer } from '#tooling/testing/integrations/guard';

async function unusedPort() {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} }
  });
  const port = server.port;

  server.stop();

  return port;
}

async function renderer(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const pages = (await response.json()) as {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
  }[];
  const page =
    pages.find((page) => page.type === 'page' && page.url.includes('obsidian.md')) ??
    pages.find((page) => page.type === 'page');

  if (!page) throw new Error('Obsidian renderer is not ready');

  return connectDevTools(page.webSocketDebuggerUrl);
}

export async function startObsidian(directory: string) {
  const executable = await requireIntegrationContainer('obsidian');

  const profile = path.join(directory, 'profile');
  const vault = path.join(directory, 'vault');

  await run(fs.makeDirectory(path.join(vault, '.obsidian'), { recursive: true }));
  await run(fs.makeDirectory(profile, { recursive: true }));
  await Bun.write(
    path.join(profile, 'obsidian.json'),
    JSON.stringify({ vaults: { studyE2E: { path: vault, ts: Date.now(), open: true } } })
  );
  await Bun.write(path.join(vault, '.obsidian/app.json'), '{}');
  const port = await unusedPort();
  const app = Bun.spawn({
    cmd: [
      executable,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-sandbox'
    ],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  });
  let logs = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    for (;;) {
      const { value, done } = await reader.read();

      if (done) {
        logs += decoder.decode();

        return;
      }

      logs += decoder.decode(value, { stream: true });
    }
  };
  const output = Promise.all([collect(app.stdout), collect(app.stderr)]);
  const stop = async () => {
    if (app.exitCode === null) app.kill('SIGTERM');

    await app.exited;
    await output;
    await Bun.write(path.join(directory, 'obsidian.log'), logs);
  };

  try {
    const connection = await waitForRenderer(
      port,
      () => {
        return app.exitCode !== null;
      },
      () => logs
    );
    const evaluate = connection.evaluate;

    await waitForVault(evaluate);

    return {
      vault,
      evaluate,
      close: async () => {
        connection.close();
        await stop();
      }
    };
  } catch (error) {
    await stop();

    throw error;
  }
}

export async function readVault(vault: string) {
  const entries = await run(fs.readDirectory(vault, { recursive: true }));
  const files = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      info: await run(fs.lstat(path.join(vault, entry)))
    }))
  );

  return Promise.all(
    files
      .filter(({ info }) => info.type === 'File')
      .map(async ({ entry }) => ({
        path: entry.replaceAll('\\', '/'),
        content: new Uint8Array(await Bun.file(path.join(vault, entry)).arrayBuffer()).toBase64()
      }))
  );
}

async function waitForRenderer(port: number, exited: () => boolean, logs: () => string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited()) throw new Error(`Obsidian exited: ${logs()}`);

    const connection = await renderer(port).catch(() => undefined);

    if (connection) return connection;

    await Bun.sleep(200);
  }

  throw new Error(`Obsidian DevTools did not start: ${logs()}`);
}

async function waitForVault(evaluate: (expression: string) => Promise<unknown>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await evaluate(
        'Boolean(window.app?.workspace?.layoutReady && window.app.vault.getName())'
      )) === true
    )
      return;

    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => /trust author|trust.*vault|enter vault/i.test(button.textContent))?.click()`
    );
    await Bun.sleep(200);
  }

  throw new Error(`Obsidian vault did not open: ${await evaluate('document.body.innerText')}`);
}
