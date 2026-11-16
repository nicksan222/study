import { test } from '@study/testing';

const owned: number[] = [];

test.afterAll(() => {
  for (const pid of owned) test.assert.throws(() => process.kill(pid, 0));
});

test.stable(
  'shared process ownership stops commands still running when their test ends',
  async () => {
    const child = test.spawnTestProcess(
      [process.execPath, '-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      {
        stdout: 'pipe',
        stderr: 'pipe'
      }
    );

    owned.push(child.pid);
    const reader = child.stdout.getReader();

    try {
      test.expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
      test.expect(child.exitCode).toBeNull();
    } finally {
      reader.releaseLock();
    }
  }
);

test.stable('shared synchronous command execution preserves exit status and output', () => {
  const result = test.spawnTestProcessSync([
    process.execPath,
    '-e',
    "console.log('observed'); process.exit(7)"
  ]);

  test.expect(result.exitCode).toBe(7);
  test.expect(result.stdout.toString()).toContain('observed');
});

test.stable('shared fixture directories are removed after failures', async () => {
  let path = '';

  await test
    .expect(
      (async () => {
        await using directory = await test.temporaryDirectory({ executable: true });

        path = directory.path;
        await Bun.write(`${path}/fixture`, 'owned');

        throw new Error('fixture failure');
      })()
    )
    .rejects.toThrow('fixture failure');
  test.expect(await Bun.file(`${path}/fixture`).exists()).toBe(false);
});

test.stable.each(['array', 'object'])(
  'synchronous commands cannot ignore the shared timeout (%s options)',
  (form) => {
    const cmd = [
      process.execPath,
      '-e',
      "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 3000);"
    ];
    const result =
      form === 'array'
        ? test.spawnTestProcessSync(cmd, { timeout: 500 })
        : test.spawnTestProcessSync({ cmd, timeout: 500 });

    test.expect(result.signalCode).toBe('SIGKILL');
  }
);
