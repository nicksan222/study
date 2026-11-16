import { test } from '@study/testing';

import { temporaryArtifacts } from './temporary.ts';

test.stable(
  'updates find the selected client capture even when invoked from another directory',
  async () => {
    const root = await temporaryArtifacts();
    const harness = `${root}/apps/client/test/e2e/harness`;

    for (const file of ['update.ts', 'identity.ts'])
      await Bun.write(`${harness}/${file}`, Bun.file(new URL(`./${file}`, import.meta.url)));

    await Bun.write(
      `${root}/package.json`,
      JSON.stringify({ scripts: { 'web:e2e': 'bun capture.ts' } })
    );
    await Bun.write(
      `${root}/capture.ts`,
      `
    await Bun.write('apps/client/test-results/updates/' + process.env.E2E_UPDATE_RUN + '/capture.json', '{}');
  `
    );
    const child = test.spawnTestProcess(['bun', `${harness}/update.ts`, 'notes/editing'], {
      cwd: harness,
      env: { ...process.env, CI: undefined },
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);

    test.expect(code, stdout + stderr).toBe(0);
  }
);

test.stable(
  'updater accepts shared safe names and rejects unsafe or unscoped selections',
  async () => {
    for (const scope of [
      '2-notes-survive-reload/editing_state',
      '2',
      'notes',
      'notes/editing',
      '',
      'notes/',
      '../editing',
      'notes/editing/extra',
      '-notes',
      'notes/../editing',
      'a'.repeat(81)
    ]) {
      const child = test.spawnTestProcess(
        [process.execPath, Bun.fileURLToPath(new URL('./update.ts', import.meta.url)), scope],
        {
          env: { ...process.env, CI: '1' },
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );
      const error = await new Response(child.stderr).text();

      test.expect(await child.exited).toBe(1);

      if (['2-notes-survive-reload/editing_state', '2', 'notes', 'notes/editing'].includes(scope))
        test.expect(error).toContain('Baseline updates are forbidden in CI');
      else test.expect(error).toMatch(/Supply one workflow|Unsafe screenshot name/);
    }
  }
);
