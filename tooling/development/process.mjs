import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

/** Commands own a process group so teardown includes Cargo/Vite grandchildren. */
export function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  // Keep launch errors available to readiness callers without an unhandled event.
  child.on('error', (error) => { child.launchError = error; });
  return child;
}

export async function stopOwned(child, gracefulSignal = 'SIGTERM') {
  if (!child?.pid) return;
  const signal = (name) => {
    try {
      if (process.platform === 'win32') child.kill(name);
      else process.kill(-child.pid, name);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const exited = child.exitCode === null && !child.signalCode ? once(child, 'exit') : Promise.resolve();
  if (!signal(gracefulSignal)) return;
  const timeout = setTimeout(() => signal('SIGKILL'), 10_000);
  timeout.unref();
  try { await exited; }
  finally {
    signal('SIGKILL');
    clearTimeout(timeout);
  }
}

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function waitReady(child, url, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  while (true) {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null || child.signalCode) throw new Error(`Service exited before ready (${child.exitCode ?? child.signalCode}): ${url}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(1000, timeout)) });
      if (response.ok) return;
    } catch { /* The owned server is compiling or binding. */ }
    if (Date.now() >= deadline) throw new Error(`Service startup timed out: ${url}`);
    await delay(Math.min(150, timeout));
  }
}
