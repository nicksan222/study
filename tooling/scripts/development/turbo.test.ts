import { testStable } from '@study/testing/vitest';
import { $ } from 'bun';
import { assert } from 'vite-plus/test';

const root = Bun.fileURLToPath(new URL('../../../', import.meta.url));

const turbo = `${root}node_modules/turbo/bin/turbo`;

const config = await Bun.file(`${root}turbo.json`).json();

const manifest = await Bun.file(`${root}package.json`).json();

type Plan = {
  tasks: { taskId: string; hash: string; dependencies: string[]; cache: { status: string } }[];
};

async function fixture() {
  const path = (await $`mktemp -d`.quiet().text()).trim();
  const directories: string[] = [];
  const command = 'bun -e "console.log(\'executed\')"';
  const rootScripts = Object.fromEntries(
    Object.keys(manifest.scripts).map((name) => [name, command])
  );

  await Bun.write(
    `${path}/package.json`,
    JSON.stringify({
      name: manifest.name,
      private: true,
      packageManager: manifest.packageManager,
      workspaces: manifest.workspaces,
      scripts: rootScripts
    })
  );

  for (const pattern of manifest.workspaces) {
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      const pkg = await Bun.file(`${root}${file}`).json();
      const directory = file.slice(0, -'/package.json'.length);

      directories.push(directory);
      const dependencies = Object.fromEntries(
        Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
          .filter((name) => name.startsWith('@study/'))
          .map((name) => [name, 'workspace:*'])
      );
      const scripts = Object.fromEntries(
        Object.keys(pkg.scripts ?? {}).map((name) => [name, command])
      );

      if (pkg.name === '@study/client')
        scripts.build = "bun -e \"await Bun.write('dist/result.txt', 'built')\"";

      await Bun.write(
        `${path}/${file}`,
        JSON.stringify({ name: pkg.name, private: true, scripts, dependencies })
      );
      await Bun.write(`${path}/${directory}/src/input.ts`, 'export const input = 1;');
    }
  }

  await Bun.write(`${path}/turbo.json`, JSON.stringify(config));
  await Bun.write(`${path}/.gitignore`, '.turbo/\nnode_modules/\n**/dist/\n');
  await Bun.write(`${path}/tooling/typescript/server.json`, '{}');
  await $`git -C ${path} init -q`.quiet();
  await $`git -C ${path} config core.hooksPath /dev/null`.quiet();
  await $`git -C ${path} add .`.quiet();
  await $`git -C ${path} -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm baseline`.quiet();

  async function run(args: string[]) {
    const child = Bun.spawn(['bun', turbo, 'run', ...args], {
      cwd: path,
      env: {
        ...process.env,
        TURBO_TELEMETRY_DISABLED: '1',
        TURBO_SCM_BASE: 'HEAD',
        TURBO_SCM_HEAD: undefined
      },
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);

    return { stdout, stderr, code };
  }

  async function plan(...args: string[]): Promise<Plan> {
    const result = await run([...args, '--dry=json']);

    assert.equal(result.code, 0, result.stderr);

    return JSON.parse(result.stdout);
  }

  return {
    path,
    directories,
    run,
    plan,
    async [Symbol.asyncDispose]() {
      await $`rm -rf ${path}`.quiet();
    }
  };
}

testStable(
  'Turbo selects dirty, untracked, staged and renamed packages plus their consumers',
  async () => {
    await using repo = await fixture();

    assert.isEmpty((await repo.plan('check', '--affected')).tasks);
    await Bun.write(`${repo.path}/packages/ui/src/input.ts`, 'changed');
    let ids = (await repo.plan('check', '--affected')).tasks.map((task) => task.taskId);

    assert.includeMembers(ids, ['@study/ui#test', '@study/client#e2e', '//#check:global']);
    assert.notInclude(ids, '@study/desktop#check');
    await $`git -C ${repo.path} checkout -- packages/ui/src/input.ts`.quiet();
    await Bun.write(`${repo.path}/packages/ui/src/new\nfile.ts`, 'untracked');
    assert.include(
      (await repo.plan('check', '--affected')).tasks.map((task) => task.taskId),
      '@study/ui#test'
    );
    await $`git -C ${repo.path} add packages/ui`.quiet();
    assert.include(
      (await repo.plan('check', '--affected')).tasks.map((task) => task.taskId),
      '@study/ui#test'
    );
    await $`git -C ${repo.path} mv packages/ui/src/input.ts packages/contracts/src/moved.ts`.quiet();
    ids = (await repo.plan('check', '--affected')).tasks.map((task) => task.taskId);
    assert.includeMembers(ids, [
      '@study/contracts#test',
      '@study/server#test',
      '@study/client#test'
    ]);
  }
);

testStable(
  'shared configuration selects every package and invalid SCM bases fail visibly',
  async () => {
    await using repo = await fixture();

    await Bun.write(`${repo.path}/tooling/typescript/server.json`, '{"changed": true}');
    const ids = (await repo.plan('check', '--affected')).tasks.map((task) => task.taskId);

    assert.includeMembers(ids, [
      '@study/server#test',
      '@study/client#test',
      '@study/desktop#check',
      '@study/db#gen:check'
    ]);
    const invalid = await repo.run([
      'check',
      '--affected',
      '--filter=...[missing-reference]',
      '--dry=json'
    ]);

    assert.notEqual(invalid.code, 0);
  }
);

testStable(
  'Turbo restores build outputs from cache and invalidates changed dependency inputs',
  async () => {
    await using repo = await fixture();
    const args = ['build', '--filter=@study/client', '--concurrency=1'];
    const before = await repo.plan(...args);

    assert.equal((await repo.run(args)).code, 0);
    await $`rm -rf ${repo.path}/apps/client/dist`.quiet();
    const cached = await repo.plan(...args);

    assert.equal(
      cached.tasks.find((task) => task.taskId === '@study/client#build')?.cache.status,
      'HIT'
    );
    assert.equal((await repo.run(args)).code, 0);
    assert.equal(await Bun.file(`${repo.path}/apps/client/dist/result.txt`).text(), 'built');
    await Bun.write(`${repo.path}/packages/ui/src/input.ts`, 'dependency changed');
    const changed = await repo.plan(...args);
    const hash = (plan: Plan) =>
      plan.tasks.find((task) => task.taskId === '@study/client#build')?.hash;

    assert.notEqual(hash(changed), hash(before));
    assert.equal(
      changed.tasks.find((task) => task.taskId === '@study/client#build')?.cache.status,
      'MISS'
    );
    assert.include(
      changed.tasks.find((task) => task.taskId === '@study/client#build')?.dependencies ?? [],
      '@study/client#typecheck'
    );
  }
);

testStable('shared test setup and native permissions affect the owning tasks', async () => {
  await using repo = await fixture();
  const hash = (plan: Plan, id: string) => plan.tasks.find((task) => task.taskId === id)?.hash;
  const before = await repo.plan('test');

  await Bun.write(`${repo.path}/apps/client/src/test/setup.ts`, 'changed');
  let after = await repo.plan('test');

  assert.notEqual(hash(after, '@study/ui#test'), hash(before, '@study/ui#test'));
  await Bun.write(`${repo.path}/apps/server/test/testing/preload.ts`, 'changed');
  after = await repo.plan('test');
  assert.notEqual(hash(after, '@study/contracts#test'), hash(before, '@study/contracts#test'));
  await Bun.write(`${repo.path}/apps/desktop/src-tauri/permissions/example.toml`, 'changed');
  const ids = (await repo.plan('test', '--affected')).tasks.map((task) => task.taskId);

  assert.include(ids, '@study/tooling#test');
});

testStable('deterministic unit tests are reusable while server tests always execute', async () => {
  await using repo = await fixture();
  const args = ['test', '--filter=@study/contracts', '--concurrency=1'];

  assert.equal((await repo.run(args)).code, 0);
  let plan = await repo.plan(...args);

  assert.equal(
    plan.tasks.find((task) => task.taskId === '@study/contracts#test')?.cache.status,
    'HIT'
  );
  await Bun.write(`${repo.path}/apps/server/test/testing/preload.ts`, 'changed setup');
  plan = await repo.plan(...args);
  assert.equal(
    plan.tasks.find((task) => task.taskId === '@study/contracts#test')?.cache.status,
    'MISS'
  );
});
