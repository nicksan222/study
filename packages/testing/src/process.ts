import type { spawn as nativeSpawn, spawnSync as nativeSpawnSync } from 'bun';

import { testPolicy } from './config.ts';

/** Native Bun subprocesses with a test-owned lifetime and a bounded shutdown. */
export const spawnScopedProcess: typeof nativeSpawn = ((...args: any[]) => {
  const [input, options] = args;
  const child = Array.isArray(input)
    ? Bun.spawn(input, { timeout: testPolicy.processTimeout, killSignal: 'SIGKILL', ...options })
    : Bun.spawn({ timeout: testPolicy.processTimeout, killSignal: 'SIGKILL', ...input });

  let closing: Promise<void> | undefined;
  const close = async () => {
    if (child.exitCode !== null) return;

    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, testPolicy.processShutdownTimeout);

    try {
      await child.exited;
    } finally {
      clearTimeout(timer);
    }
  };

  Object.defineProperty(child, Symbol.asyncDispose, { value: () => (closing ??= close()) });

  return child;
}) as typeof nativeSpawn;

/** Sync command checks use the same bounded execution budget as async commands. */
export const spawnTestProcessSync: typeof nativeSpawnSync = ((...args: any[]) => {
  const [input, options] = args;

  return Array.isArray(input)
    ? Bun.spawnSync(input, {
        timeout: testPolicy.processTimeout,
        killSignal: 'SIGKILL',
        ...options
      })
    : Bun.spawnSync({ timeout: testPolicy.processTimeout, killSignal: 'SIGKILL', ...input });
}) as typeof nativeSpawnSync;
