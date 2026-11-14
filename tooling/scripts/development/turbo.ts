import { pruneTaskCache } from './task-cache.ts';

const root = Bun.fileURLToPath(new URL('../../../', import.meta.url));

const child = Bun.spawn(
  [process.execPath, '--bun', `${root}node_modules/turbo/bin/turbo`, ...process.argv.slice(2)],
  { stdio: ['inherit', 'inherit', 'inherit'] }
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));

const exitCode = await child.exited;

try {
  if (!process.argv.some((argument) => /^--dry(?:-run)?(?:=|$)/.test(argument))) {
    await pruneTaskCache(`${root}.turbo/cache`);
    await pruneTaskCache(`${root}node_modules/.vitest-cache`, {
      format: 'vitest',
      maxBytes: 128 * 1024 * 1024
    });
  }
} catch (error) {
  console.warn('Could not retire task cache entries:', error);
}

process.exitCode = exitCode;
