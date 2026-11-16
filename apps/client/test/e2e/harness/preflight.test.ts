import { test } from '@study/testing';
import type { JSONReport, JSONReportSpec, JSONReportSuite } from 'playwright/types/testReporter';

import { workflowName } from './identity.ts';
import { assertSnapshotComparison } from './preflight.ts';
import { temporaryArtifacts } from './temporary.ts';

async function fixture(
  { spawnTestProcess, onTestFinished }: Pick<test.Context, 'spawnTestProcess' | 'onTestFinished'>,
  titles: string[],
  suite = ''
) {
  const directory = await temporaryArtifacts({ onTestFinished });
  const config = `${directory}/playwright.config.ts`;
  const preflight = Bun.fileURLToPath(new URL('./preflight.ts', import.meta.url));
  const harness = Bun.fileURLToPath(new URL('./index.ts', import.meta.url));

  await Bun.write(
    config,
    `
    import { installTestApi } from '@study/testing';
    import { test as browserApi } from ${JSON.stringify(harness)};
    import { workflowSelection } from ${JSON.stringify(preflight)};
    installTestApi(browserApi);
    export default { testDir: ${JSON.stringify(directory)}, testMatch: '*.spec.ts',
      globalSetup: ${JSON.stringify(preflight)}, outputDir: ${JSON.stringify(`${directory}/output`)},
      updateSnapshots: 'none', tag: '@stable', grep: await workflowSelection(import.meta.filename, process.env.E2E_UPDATE), workers: 1, reporter: 'list' };
  `
  );

  for (const [index, title] of titles.entries()) {
    const registration = `test.stable(${JSON.stringify(title)}, {tag: ['@journey', ${JSON.stringify(`@workflow:${workflowName(title)}`)}]}, async () => { await Bun.write(${JSON.stringify(`${directory}/${index}.txt`)}, 'executed'); });`;

    await Bun.write(
      `${directory}/${index}.spec.ts`,
      `
      import { test } from '@study/testing';
      ${suite ? `test.describe(${JSON.stringify(suite)}, () => { ${registration} });` : registration}
    `
    );
  }

  return {
    directory,
    async run(scope?: string, flags: string[] = []) {
      const child = spawnTestProcess(
        ['bun', '--bun', 'playwright', 'test', '--config', config, ...flags],
        {
          env: {
            ...process.env,
            E2E_UPDATE: scope,
            PLAYWRIGHT_BROWSERS_PATH: `${directory}/no-browsers`
          },
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

test.stable.for([
  ['Notes retain edits', 'Notes: retain edits'],
  ['Notes retain edits', 'Notes retain edits'],
  ['Notes\nretain edits', 'Notes retain edits'],
  ['Notes\tretain edits', 'Notes retain edits'],
  ['Notes\u00a0retain edits', 'Notes retain edits']
])(
  'native preflight rejects cross-file baseline collisions for %j',
  async (titles, { expect, spawnTestProcess, onTestFinished }) => {
    const { directory, run } = await fixture({ onTestFinished, spawnTestProcess }, titles);
    const result = await run('notes-retain-edits');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('Baseline identity collision');

    for (const index of [0, 1])
      expect(await Bun.file(`${directory}/${index}.txt`).exists()).toBe(false);
  }
);

test.stable.for(['', 'Editor "quoted" \\ path > [draft]?'])(
  'native catalog selects exact nested titles in %s',
  async (suite, { expect, spawnTestProcess, onTestFinished }) => {
    const titles = [
      '2 Notes: retain edits. [draft]?',
      'Reopened 2 Notes: retain edits. [draft]?',
      'Notes "retain" edits.'
    ];
    const { directory, run } = await fixture({ onTestFinished, spawnTestProcess }, titles, suite);
    const result = await run('2-notes-retain-edits-draft/settings');

    expect(result.code, result.output).toBe(0);
    expect(await Bun.file(`${directory}/0.txt`).exists()).toBe(true);
    expect(await Bun.file(`${directory}/1.txt`).exists()).toBe(false);
    expect(await Bun.file(`${directory}/2.txt`).exists()).toBe(false);
  }
);

test.stable.for(['--update-snapshots', '--ignore-snapshots'])(
  'native snapshot overrides fail before running a journey: %s',
  async (flag, { expect, spawnTestProcess, onTestFinished }) => {
    const { directory, run } = await fixture({ onTestFinished, spawnTestProcess }, [
      'One scoped journey'
    ]);
    const result = await run(undefined, [flag]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('native snapshot overrides are forbidden');
    expect(await Bun.file(`${directory}/0.txt`).exists()).toBe(false);
  }
);

test.stable(
  'per-comparison policy rejects UI run overrides and ignored snapshots',
  ({ expect }) => {
    expect(() => assertSnapshotComparison('none', false)).not.toThrow();

    for (const mode of ['all', 'changed', 'missing', 'default'] as const)
      expect(() => assertSnapshotComparison(mode, false)).toThrow(
        'native snapshot overrides are forbidden'
      );

    expect(() => assertSnapshotComparison('none', true)).toThrow(
      'native snapshot overrides are forbidden'
    );
  }
);

test.stable(
  'native shards partition every journey and distribute settings cases within one file',
  async ({ expect, spawnTestProcess }) => {
    async function catalog(
      { spawnTestProcess, expect }: Pick<test.Context, 'spawnTestProcess' | 'expect'>,
      shard?: string
    ) {
      const child = spawnTestProcess(
        [
          'bun',
          '--bun',
          'playwright',
          'test',
          '--config',
          'playwright.config.ts',
          '--list',
          '--reporter=json',
          ...(shard ? [`--shard=${shard}`] : [])
        ],
        {
          cwd: Bun.fileURLToPath(new URL('../../../', import.meta.url)),
          env: { ...process.env, E2E_UPDATE: undefined },
          stdout: 'pipe',
          stderr: 'pipe'
        }
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]);

      expect(code, stderr).toBe(0);
      const report: JSONReport = JSON.parse(stdout);
      const specs: JSONReportSpec[] = [];

      function visit(suite: JSONReportSuite) {
        specs.push(...suite.specs);

        for (const child of suite.suites ?? []) visit(child);
      }

      for (const suite of report.suites) visit(suite);

      return specs;
    }

    const [all, ...shards] = await Promise.all([
      catalog({ spawnTestProcess, expect }),
      catalog({ spawnTestProcess, expect }, '1/3'),
      catalog({ spawnTestProcess, expect }, '2/3'),
      catalog({ spawnTestProcess, expect }, '3/3')
    ]);
    const ids = (specs: typeof all) => specs.map((spec) => spec.id).sort();

    expect(ids(shards.flat())).toEqual(ids(all));
    expect(new Set(ids(shards.flat())).size).toBe(all.length);

    expect(
      shards.filter((shard) => shard.some((spec) => spec.file.endsWith('settings.test.ts'))).length
    ).toBeGreaterThan(1);

    // The two consecutive fixtures must stay on one worker to exercise fixture cleanup.
    expect(
      shards
        .map(
          (shard) => shard.filter((spec) => spec.file.endsWith('worker-a.browser.test.ts')).length
        )
        .sort()
    ).toEqual([0, 0, 2]);
  }
);
