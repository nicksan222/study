import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { workflowName } from './identity.ts';
import { temporaryArtifacts } from './temporary.ts';

async function fixture(titles: string[], suite = '') {
  const directory = await temporaryArtifacts();
  const config = `${directory}/playwright.config.ts`;
  const preflight = Bun.fileURLToPath(new URL('./preflight.ts', import.meta.url));

  await Bun.write(
    config,
    `
    import { workflowSelection } from ${JSON.stringify(preflight)};
    export default { testDir: ${JSON.stringify(directory)}, testMatch: '*.spec.ts',
      globalSetup: ${JSON.stringify(preflight)}, outputDir: ${JSON.stringify(`${directory}/output`)},
      updateSnapshots: 'none', tag: '@stable', grep: await workflowSelection(import.meta.filename, process.env.E2E_UPDATE), workers: 1, reporter: 'list' };
  `
  );

  for (const [index, title] of titles.entries()) {
    const registration = `test(${JSON.stringify(title)}, {tag: ['@journey', ${JSON.stringify(`@workflow:${workflowName(title)}`)}]}, async () => { await Bun.write(${JSON.stringify(`${directory}/${index}.txt`)}, 'executed'); });`;

    await Bun.write(
      `${directory}/${index}.spec.ts`,
      `
      import { test } from 'playwright/test';
      ${suite ? `test.describe(${JSON.stringify(suite)}, () => { ${registration} });` : registration}
    `
    );
  }

  return {
    directory,
    async run(scope?: string, flags: string[] = []) {
      const child = Bun.spawn(
        ['bun', '--bun', 'playwright', 'test', '--config', config, ...flags],
        {
          env: { ...process.env, E2E_UPDATE: scope },
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]);

      return { code, output: stdout + stderr };
    }
  };
}

testStable.each([
  ['Notes retain edits', 'Notes: retain edits'],
  ['Notes retain edits', 'Notes retain edits'],
  ['Notes\nretain edits', 'Notes retain edits'],
  ['Notes\tretain edits', 'Notes retain edits'],
  ['Notes\u00a0retain edits', 'Notes retain edits']
])('native preflight rejects cross-file baseline collisions for %j', async (...titles) => {
  const { directory, run } = await fixture(titles);
  const result = await run('notes-retain-edits');

  expect(result.code).not.toBe(0);
  expect(result.output).toContain('Baseline identity collision');

  for (const index of [0, 1])
    expect(await Bun.file(`${directory}/${index}.txt`).exists()).toBe(false);
});

testStable.each(['', 'Editor "quoted" \\ path > [draft]?'])(
  'native catalog selects exact nested titles in %s',
  async (suite) => {
    const titles = [
      '2 Notes: retain edits. [draft]?',
      'Reopened 2 Notes: retain edits. [draft]?',
      'Notes "retain" edits.'
    ];
    const { directory, run } = await fixture(titles, suite);
    const result = await run('2-notes-retain-edits-draft/settings');

    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(`${directory}/0.txt`).exists()).toBe(true);
    expect(await Bun.file(`${directory}/1.txt`).exists()).toBe(false);
    expect(await Bun.file(`${directory}/2.txt`).exists()).toBe(false);
  }
);

testStable.each(['--update-snapshots', '--ignore-snapshots'])(
  'native snapshot overrides fail before running a journey: %s',
  async (flag) => {
    const { directory, run } = await fixture(['One scoped journey']);
    const result = await run(undefined, [flag]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('native snapshot overrides are forbidden');
    expect(await Bun.file(`${directory}/0.txt`).exists()).toBe(false);
  }
);
