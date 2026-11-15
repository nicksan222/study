import { spawnTestProcess } from '@study/testing/vitest';
import { temporaryDirectory } from '@study/testing/vitest';
import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

type Workflow = {
  jobs: Record<
    string,
    {
      name: string;
      needs?: string | string[];
      if?: string;
      strategy?: unknown;
      uses?: string;
      steps?: { run?: string }[];
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

testStable('all CI lanes start independently and feed the required merge gate', () => {
  assert.sameMembers(workflow.jobs.check!.needs as string[], lanes);
  assert.equal(workflow.jobs.check!.name, 'Test and build');

  for (const name of lanes) {
    const job = workflow.jobs[name]!;

    assert.isDefined(job);
    assert.isUndefined(job.needs);
    assert.isUndefined(job.if);
    assert.isUndefined(job.strategy);
  }
});

testStable.each(['success', 'failure', 'cancelled', 'skipped', 'missing'])(
  'the required gate handles a %s lane result without allowing an unsafe merge',
  async (status) => {
    await using temporary = await temporaryDirectory();
    const directory = temporary.path;

    {
      const results = Object.fromEntries(lanes.map((lane) => [lane, { result: 'success' }]));

      if (status === 'missing') delete results.database;
      else results.database!.result = status;

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

testStable(
  'release publication waits for four independent platform builds without a matrix',
  async () => {
    const release = Bun.YAML.parse(
      await Bun.file(new URL('.github/workflows/release.yml', root)).text()
    ) as Workflow;
    const platforms = ['linux_x64', 'linux_arm64', 'macos', 'windows'];

    assert.sameMembers(release.jobs.publish!.needs as string[], ['version', ...platforms]);

    for (const name of platforms) {
      const job = release.jobs[name]!;

      assert.equal(job.needs, 'version');
      assert.equal(job.uses, './.github/workflows/release-platform.yml');
      assert.isUndefined(job.if);
      assert.isUndefined(job.strategy);
    }
  }
);
