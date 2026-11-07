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

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { requireIntegrationContainer } from '#integration-tests/guard';

async function unusedPort() {
  const server = createServer();

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('No DevTools port');

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );

  return address.port;
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

  const socket = new WebSocket(page.webSocketDebuggerUrl);

  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  socket.addEventListener('message', (message) => {
    const response = JSON.parse(String(message.data));
    const request = pending.get(response.id);

    if (!request) return;

    pending.delete(response.id);

    if (response.error || response.result?.exceptionDetails)
      request.reject(new Error(JSON.stringify(response)));
    else request.resolve(response.result?.result?.value);
  });

  return {
    evaluate: (expression: string) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++sequence;

        pending.set(id, { resolve, reject });
        socket.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        );
      }),
    close: () => socket.close()
  };
}

export { requireIntegrationContainer as requireObsidianContainer } from '#integration-tests/guard';

export async function startObsidian(directory: string) {
  const executable = requireIntegrationContainer('obsidian');

  const profile = join(directory, 'profile');
  const vault = join(directory, 'vault');

  await mkdir(join(vault, '.obsidian'), { recursive: true });
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, 'obsidian.json'),
    JSON.stringify({ vaults: { studyE2E: { path: vault, ts: Date.now(), open: true } } })
  );
  await writeFile(join(vault, '.obsidian/app.json'), '{}');
  const port = await unusedPort();
  const app = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-sandbox'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let logs = '';
  let launchError: Error | undefined;

  app.on('error', (error) => {
    launchError = error;
  });

  app.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  app.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const stop = async () => {
    if (!app.pid || app.exitCode !== null || app.signalCode !== null) return;

    app.kill('SIGTERM');
    await once(app, 'exit');
    await writeFile(join(directory, 'obsidian.log'), logs);
  };

  try {
    const connection = await waitForRenderer(
      port,
      () => {
        if (launchError) throw launchError;

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
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(vault, { recursive: true, withFileTypes: true });

  return Promise.all(
    files
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({
        path: join(entry.parentPath, entry.name)
          .slice(vault.length + 1)
          .replaceAll('\\', '/'),
        content: (await readFile(join(entry.parentPath, entry.name))).toString('base64')
      }))
  );
}

async function waitForRenderer(port: number, exited: () => boolean, logs: () => string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited()) throw new Error(`Obsidian exited: ${logs()}`);

    const connection = await renderer(port).catch(() => undefined);

    if (connection) return connection;

    await setTimeout(200);
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
    await setTimeout(200);
  }

  throw new Error(`Obsidian vault did not open: ${await evaluate('document.body.innerText')}`);
}
