import { test } from '@study/testing';

const owned: number[] = [];

test.unit.stable(
  'shared process ownership stops commands still running when their test ends',
  async ({ spawnTestProcess, expect }) => {
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

test.unit.stable(
  'shared synchronous command execution preserves exit status and output',
  ({ spawnTestProcessSync, expect }) => {
    const result = spawnTestProcessSync([
      process.execPath,
      '-e',
      "console.log('observed'); process.exit(7)"
    ]);

    expect(result.exitCode).toBe(7);
    expect(result.stdout.toString()).toContain('observed');
  }
);

test.unit.stable(
  'shared fixture directories are removed after failures',
  async ({ expect, temporaryDirectory }) => {
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
  }
);

test.unit.stable.for(['array', 'object'])(
  'synchronous commands cannot ignore the shared timeout (%s options)',
  (form, { spawnTestProcessSync, expect }) => {
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

test.unit.stable('completed tests release their owned processes', ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  for (const pid of owned) assert.throws(() => process.kill(pid, 0));
});
