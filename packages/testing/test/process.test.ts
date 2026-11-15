import { spawnTestProcess, spawnTestProcessSync } from '@study/testing/process';
import { temporaryDirectory } from '@study/testing/resources';
import { testStable } from '@study/testing/vitest';
import { afterAll, assert, expect } from 'vite-plus/test';

const owned: number[] = [];

afterAll(() => {
  for (const pid of owned) assert.throws(() => process.kill(pid, 0));
});

testStable(
  'shared process ownership stops commands still running when their test ends',
  async () => {
    const child = spawnTestProcess(
      [process.execPath, '-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      {
        stdout: 'pipe',
        stderr: 'pipe'
      }
    );

    owned.push(child.pid);
    const reader = child.stdout.getReader();

    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
      expect(child.exitCode).toBeNull();
    } finally {
      reader.releaseLock();
    }
  }
);

testStable('shared synchronous command execution preserves exit status and output', () => {
  const result = spawnTestProcessSync([
    process.execPath,
    '-e',
    "console.log('observed'); process.exit(7)"
  ]);

  expect(result.exitCode).toBe(7);
  expect(result.stdout.toString()).toContain('observed');
});

testStable('shared fixture directories are removed after failures', async () => {
  let path = '';

  await expect(
    (async () => {
      await using directory = await temporaryDirectory({ executable: true });

      path = directory.path;
      await Bun.write(`${path}/fixture`, 'owned');

      throw new Error('fixture failure');
    })()
  ).rejects.toThrow('fixture failure');
  expect(await Bun.file(`${path}/fixture`).exists()).toBe(false);
});

testStable.each(['array', 'object'])(
  'synchronous commands cannot ignore the shared timeout (%s options)',
  (form) => {
    const cmd = [
      process.execPath,
      '-e',
      "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 3000);"
    ];
    const result =
      form === 'array'
        ? spawnTestProcessSync(cmd, { timeout: 500 })
        : spawnTestProcessSync({ cmd, timeout: 500 });

    expect(result.signalCode).toBe('SIGKILL');
  }
);
