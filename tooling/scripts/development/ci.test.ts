import { test } from '@study/testing';

type Workflow = {
  jobs: Record<
    string,
    {
      name: string;
      needs?: string | string[];
      if?: string;
      strategy?: { 'fail-fast': boolean; 'max-parallel': number; matrix: { shard: number[] } };
      uses?: string;
      steps?: { run?: string; if?: string; uses?: string; with?: Record<string, string> }[];
    }
  >;
};

const root = new URL('../../../', import.meta.url);

const workflow = Bun.YAML.parse(
  await Bun.file(new URL('.github/workflows/ci.yml', root)).text()
) as Workflow;

const lanes = [
  'hygiene',
  'javascript',
  'server_tests',
  'database',
  'browser',
  'native',
  'integrations',
  'landing'
];

test.stable('all CI lanes start independently and feed the required merge gate', () => {
  test.assert.sameMembers(workflow.jobs.check!.needs as string[], lanes);
  test.assert.equal(workflow.jobs.check!.name, 'Test and build');

  for (const name of lanes) {
    const job = workflow.jobs[name]!;

    test.assert.isDefined(job);
    test.assert.isUndefined(job.needs);
    test.assert.isUndefined(job.if);

    if (name !== 'browser') test.assert.isUndefined(job.strategy);
  }
});

test.stable('browser shards run the full catalog without cancelling sibling diagnostics', () => {
  const browser = workflow.jobs.browser!;

  test.assert.deepEqual(browser.strategy, {
    'fail-fast': false,
    'max-parallel': 3,
    matrix: { shard: [1, 2, 3] }
  });
  const runner = browser.steps!.find((step) => step.with?.runCmd);
  const artifacts = browser.steps!.find((step) =>
    step.uses?.startsWith('actions/upload-artifact@')
  );

  test.assert.equal(runner?.with?.runCmd, 'bun run web:e2e:compare --shard=${{ matrix.shard }}/3');
  test.assert.equal(artifacts?.if, '${{ always() }}');
  test.assert.equal(artifacts?.with?.name, 'web-e2e-diagnostics-${{ matrix.shard }}');
});

test.stable.each(['success', 'failure', 'cancelled', 'skipped', 'missing'])(
  'the required gate handles a %s lane result without allowing an unsafe merge',
  async (status) => {
    await using temporary = await test.temporaryDirectory();
    const directory = temporary.path;

    {
      const results = Object.fromEntries(lanes.map((lane) => [lane, { result: 'success' }]));

      if (status === 'missing') delete results.browser;
      else results.browser!.result = status;

      const script = workflow.jobs.check!.steps![0]!.run!;
      const child = test.spawnTestProcess(['bash', '-c', script], {
        env: {
          ...process.env,
          RESULTS: JSON.stringify(results),
          GITHUB_STEP_SUMMARY: `${directory}/summary.md`
        },
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

      test.assert.equal(code, status === 'success' ? 0 : 1, stderr);
      test.assert.include(await Bun.file(`${directory}/summary.md`).text(), 'Study CI');
    }
  }
);

test.stable(
  'release publication waits for four independent platform builds without a matrix',
  async () => {
    const release = Bun.YAML.parse(
      await Bun.file(new URL('.github/workflows/release.yml', root)).text()
    ) as Workflow;
    const platforms = ['linux_x64', 'linux_arm64', 'macos', 'windows'];

    test.assert.sameMembers(release.jobs.publish!.needs as string[], ['version', ...platforms]);

    for (const name of platforms) {
      const job = release.jobs[name]!;

      test.assert.equal(job.needs, 'version');
      test.assert.equal(job.uses, './.github/workflows/release-platform.yml');
      test.assert.isUndefined(job.if);

      test.assert.isUndefined(job.strategy);
    }
  }
);
