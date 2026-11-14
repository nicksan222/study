import { maintainTaskCaches } from './task-cache.ts';

const root = Bun.fileURLToPath(new URL('../../../', import.meta.url));

const ownGroup = process.platform !== 'win32';

const child = Bun.spawn(
  [process.execPath, '--bun', `${root}node_modules/turbo/bin/turbo`, ...process.argv.slice(2)],
  { stdio: ['inherit', 'inherit', 'inherit'], detached: ownGroup }
);

let interrupted: number | undefined;

const signals = ownGroup
  ? (['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM'] as const)
  : (['SIGINT', 'SIGTERM'] as const);

const handlers = signals.map((signal) => {
  const forward = () => {
    interrupted = { SIGHUP: 129, SIGINT: 130, SIGQUIT: 131, SIGTERM: 143 }[signal];

    try {
      // Native Turbo handles TERM gracefully; QUIT would bypass task teardown.
      const forwarded = signal === 'SIGQUIT' ? 'SIGTERM' : signal;

      if (ownGroup) process.kill(-child.pid, forwarded);
      else child.kill(signal);
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ESRCH'
      )
        throw error;
    }
  };

  process.on(signal, forward);

  return { signal, forward };
});

const exitCode = await child.exited;

for (const { signal, forward } of handlers) process.off(signal, forward);

if (!process.argv.some((argument) => /^--dry(?:-run)?(?:=|$)/.test(argument))) {
  const results = await maintainTaskCaches(root);

  for (const [index, result] of results.entries())
    if (result.status === 'rejected')
      console.warn(
        `Could not retire ${index === 0 ? 'Turbo' : 'Vitest'} cache entries:`,
        result.reason
      );
}

process.exitCode = interrupted ?? exitCode;
