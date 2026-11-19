import { test } from '@study/testing';

type Workflow = {
  jobs: Record<
    string,
    {
      name: string;
      needs?: string | string[];
      if?: string;
      'runs-on'?: string;
      strategy?: { 'fail-fast': boolean; 'max-parallel': number; matrix: { shard: number[] } };
      uses?: string;
      steps?: {
        id?: string;
        run?: string;
        if?: string;
        uses?: string;
        with?: Record<string, string>;
      }[];
    }
  >;
};

const root = new URL('../../../', import.meta.url);

const workflow = Bun.YAML.parse(
  await Bun.file(new URL('.github/workflows/ci.yml', root)).text()
) as Workflow;

const lanes = [
  'hygiene',
  'types',
  'client_unit',
  'tooling_unit',
  'server_tests',
  'recognition',
  'shared_tests',
  'database',
  'browser',
  'native',
  'integrations',
  'landing'
];

const prerequisites: Record<string, string[]> = {
  server_tests: ['hygiene', 'types'],
  browser: ['hygiene', 'types']
};

test.unit.stable(
  'the required recognition lane prepares pinned speech assets and runs the real model matrix',
  ({ expect }) => {
    const steps = workflow.jobs.recognition!.steps!;
    const voiceSteps = steps.filter((step) => step.run?.startsWith('bun run voice:'));
    const setupReady = "${{ !cancelled() && steps.setup.outcome == 'success' }}";

    expect(steps.find((step) => step.id === 'setup')?.uses).toBe(
      './.github/actions/setup-javascript'
    );
    expect(steps.find((step) => step.uses === 'actions/cache@v4')?.if).toBe(setupReady);
    expect(voiceSteps).toMatchObject([
      { id: 'voice_fixtures', run: 'bun run voice:fixtures', if: setupReady },
      {
        run: 'bun run voice:test',
        if: "${{ !cancelled() && steps.voice_fixtures.outcome == 'success' }}"
      }
    ]);
  }
);

test.unit.stable(
  'the required merge gate covers every lane and gates heavy suites on static checks',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.sameMembers(workflow.jobs.check!.needs as string[], lanes);
    assert.equal(workflow.jobs.check!.name, 'Test and build');

    for (const name of lanes) {
      const job = workflow.jobs[name]!;

      assert.isDefined(job);
      assert.deepEqual(job.needs, prerequisites[name]);
      assert.isUndefined(job.if);

      if (!['browser', 'server_tests', 'client_unit', 'tooling_unit'].includes(name))
        assert.isUndefined(job.strategy);
    }
  }
);

test.unit.stable.for([
  {
    lane: 'client_unit',
    command: 'bun run ci:client-unit --shard=${{ matrix.shard }}/3',
    artifact: 'vitest-client-reports-${{ matrix.shard }}'
  },
  {
    lane: 'tooling_unit',
    command: 'bun run ci:tooling-unit --shard=${{ matrix.shard }}/3',
    artifact: 'vitest-tooling-reports-${{ matrix.shard }}'
  },
  {
    lane: 'browser',
    command: 'bun run web:e2e:compare --shard=${{ matrix.shard }}/3',
    artifact: 'web-e2e-diagnostics-${{ matrix.shard }}'
  },
  {
    lane: 'server_tests',
    command: 'bun run ci:server --shard=${{ matrix.shard }}/3',
    artifact: 'vitest-server-reports-${{ matrix.shard }}'
  }
])(
  '$lane shards run without cancelling sibling diagnostics',
  ({ lane, command, artifact }, { assert: assertions }) => {
    const assert: test.Assert = assertions;

    const job = workflow.jobs[lane]!;

    assert.deepEqual(job.strategy, {
      'fail-fast': false,
      'max-parallel': 3,
      matrix: { shard: [1, 2, 3] }
    });
    const runner = job.steps!.find((step) => step.with?.runCmd ?? step.run);
    const artifacts = job.steps!.find((step) => step.uses?.startsWith('actions/upload-artifact@'));

    assert.equal(runner?.with?.runCmd ?? runner?.run, command);
    assert.equal(artifacts?.with?.name, artifact);
    assert.equal(artifacts?.if, '${{ always() }}');
  }
);

test.unit.stable.for(['success', 'failure', 'cancelled', 'skipped', 'missing'])(
  'the required gate handles a %s lane result without allowing an unsafe merge',
  async (status, { temporaryDirectory, spawnTestProcess, assert: assertions }) => {
    const assert: test.Assert = assertions;

    await using temporary = await temporaryDirectory();
    const directory = temporary.path;

    {
      const results = Object.fromEntries(lanes.map((lane) => [lane, { result: 'success' }]));

      if (status === 'missing') delete results.browser;
      else results.browser!.result = status;

      const script = workflow.jobs.check!.steps![0]!.run!;
      const child = spawnTestProcess(['bash', '-c', script], {
        env: {
          ...process.env,
          RESULTS: JSON.stringify(results),
          GITHUB_STEP_SUMMARY: `${directory}/summary.md`
        },
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

      assert.equal(code, status === 'success' ? 0 : 1, stderr);
      assert.include(await Bun.file(`${directory}/summary.md`).text(), 'Study CI');
    }
  }
);

test.unit.stable(
  'release publication waits for every platform and the packaged macOS WebView',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const release = Bun.YAML.parse(
      await Bun.file(new URL('.github/workflows/release.yml', root)).text()
    ) as Workflow;
    const platforms = ['linux_x64', 'linux_arm64', 'macos', 'windows'];

    assert.sameMembers(release.jobs.publish!.needs as string[], [
      'version',
      ...platforms,
      'macos_webview'
    ]);

    const webview = release.jobs.macos_webview!;

    assert.equal(webview.needs, 'macos');
    assert.equal(webview['runs-on'], 'xcode-27');
    assert.equal(
      webview.steps!.find((step) => step.uses?.startsWith('actions/download-artifact@'))?.with
        ?.name,
      'bundle-macos-aarch64'
    );
    assert.isTrue(
      webview.steps!.some((step) =>
        step.run?.includes('smoke_macos_webview.py target/macos-release/study-macos-aarch64.dmg')
      )
    );

    for (const name of platforms) {
      const job = release.jobs[name]!;

      assert.equal(job.needs, 'version');
      assert.equal(job.uses, './.github/workflows/release-platform.yml');
      assert.isUndefined(job.if);

      assert.isUndefined(job.strategy);
    }
  }
);
