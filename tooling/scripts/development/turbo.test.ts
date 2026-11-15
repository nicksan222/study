import { testStable } from '@study/testing/vitest';
import { $ } from 'bun';
import { assert, onTestFinished } from 'vite-plus/test';

const root = Bun.fileURLToPath(new URL('../../../', import.meta.url));

const turbo = `${root}node_modules/turbo/bin/turbo`;

const config = await Bun.file(`${root}turbo.json`).json();

const manifest = await Bun.file(`${root}package.json`).json();

type Plan = {
  tasks: {
    taskId: string;
    command?: string;
    hash: string;
    dependencies: string[];
    cache: { status: string };
  }[];
};

type Workflow = {
  jobs: Record<string, { steps?: { run?: string; with?: { runCmd?: string } }[] }>;
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

  async function execute(args: string[]) {
    const child = Bun.spawn(args, {
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

  const run = (args: string[]) => execute(['bun', turbo, 'run', ...args]);

  async function script(name: string, ...args: string[]) {
    const file = Bun.file(`${path}/package.json`);
    const pkg = await file.json();

    pkg.scripts[name] = manifest.scripts[name];
    await Bun.write(file, JSON.stringify(pkg));

    for (const source of ['turbo.ts', 'task-cache.ts'])
      await Bun.write(
        `${path}/tooling/scripts/development/${source}`,
        Bun.file(`${root}tooling/scripts/development/${source}`)
      );

    await $`mkdir -p ${path}/node_modules/@effect`.quiet();

    for (const dependency of ['turbo', 'effect', '@effect/platform-bun'])
      await $`ln -sfn ${root}node_modules/${dependency} ${path}/node_modules/${dependency}`.quiet();

    return execute(['bun', 'run', name, ...args]);
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
    script,
    async [Symbol.asyncDispose]() {
      await $`rm -rf ${path}`.quiet();
    }
  };
}

testStable('CI gate groups cover the full check, including the packaged runtime', async () => {
  await using repo = await fixture();
  const commands = (plan: Plan) =>
    plan.tasks
      .filter((task) => task.command && task.command !== '<NONEXISTENT>')
      .map((task) => task.taskId)
      .sort();
  const full = commands(await repo.plan('check'));
  const workflow = Bun.YAML.parse(
    await Bun.file(`${root}.github/workflows/ci.yml`).text()
  ) as Workflow;
  const groups: Plan[] = [];

  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      const script = /^bun run (\S+)$/.exec(step.run ?? step.with?.runCmd ?? '')?.[1];

      if (!script) continue;

      const result = await repo.script(script, '--dry=json');

      assert.equal(result.code, 0, result.stderr);
      groups.push(JSON.parse(result.stdout));
    }
  }

  const selected = [...new Set(groups.flatMap(commands))].sort();

  assert.include(full, '//#runtime:smoke');
  assert.include(full, '//#desktop:runtime');
  assert.deepEqual(selected, full);
  const javascript = commands(await repo.plan('check:javascript'));
  const server = commands(await repo.plan('check:server'));
  const database = commands(await repo.plan('check:database'));
  const native = commands(await repo.plan('check:native'));

  assert.include(javascript, '@study/server#typecheck');
  assert.include(javascript, '@study/client#build');
  assert.deepEqual(database, ['@study/db#test']);
  assert.notInclude(server, '@study/db#test');
  assert.notInclude(native, '//#lint:repo');
  assert.notInclude(native, '//#check:landing');
  assert.notInclude(server, '@study/server#typecheck');
  assert.isEmpty(javascript.filter((task) => task.endsWith('#test') && server.includes(task)));
});

testStable(
  'browser comparison keeps its build prerequisite and forwards runner options',
  async () => {
    await using repo = await fixture();
    const file = Bun.file(`${repo.path}/apps/client/package.json`);
    const pkg = await file.json();

    pkg.scripts.e2e = 'bun -e "console.log(JSON.stringify(Bun.argv))" --';
    await Bun.write(file, JSON.stringify(pkg));
    const result = await repo.script('web:e2e:compare', '--workers', '2');

    assert.equal(result.code, 0, result.stderr);
    assert.include(result.stdout, '"--workers","2"');
    assert.equal(await Bun.file(`${repo.path}/apps/client/dist/result.txt`).text(), 'built');
  }
);

testStable('a failed runtime preparation prevents its smoke test from running', async () => {
  await using repo = await fixture();
  const file = Bun.file(`${repo.path}/package.json`);
  const pkg = await file.json();

  pkg.scripts['desktop:runtime'] = 'bun -e "process.exit(23)"';
  pkg.scripts['runtime:smoke'] = "bun -e \"await Bun.write('smoke-ran', 'unexpected')\"";
  await Bun.write(file, JSON.stringify(pkg));
  const result = await repo.script('ci:native');

  assert.notEqual(result.code, 0);
  assert.isFalse(await Bun.file(`${repo.path}/smoke-ran`).exists());
});

testStable('failed formatting leaves independent native gates runnable', async () => {
  await using repo = await fixture();
  const nativeFile = Bun.file(`${repo.path}/apps/desktop/package.json`);
  const nativePkg = await nativeFile.json();

  nativePkg.scripts['fmt:check'] = 'bun -e "process.exit(23)"';

  for (const task of ['lint', 'deny', 'test', 'docs'])
    nativePkg.scripts[task] = `bun -e "await Bun.write('gate-${task}', 'ran')"`;

  await Bun.write(nativeFile, JSON.stringify(nativePkg));
  const result = await repo.script('ci:native');

  assert.notEqual(result.code, 0);

  for (const task of ['lint', 'deny', 'test', 'docs'])
    assert.equal(await Bun.file(`${repo.path}/apps/desktop/gate-${task}`).text(), 'ran');
});

testStable('CI overlaps the client build with independent tooling tests', async () => {
  await using repo = await fixture();

  for (const [directory, task, own, other] of [
    ['apps/client', 'build', 'build-started', 'tests-started'],
    ['tooling', 'test', 'tests-started', 'build-started']
  ]) {
    const file = Bun.file(`${repo.path}/${directory}/package.json`);
    const pkg = await file.json();

    pkg.scripts[task!] = 'bun overlap.ts';
    await Bun.write(file, JSON.stringify(pkg));
    await Bun.write(
      `${repo.path}/${directory}/overlap.ts`,
      `await Bun.write('${repo.path}/${own}', 'started');
       const deadline = Date.now() + 5000;
       while (!(await Bun.file('${repo.path}/${other}').exists())) {
         if (Date.now() > deadline) process.exit(23);
         await Bun.sleep(10);
       }`
    );
  }

  const result = await repo.script('ci:javascript');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.isTrue(await Bun.file(`${repo.path}/build-started`).exists());
  assert.isTrue(await Bun.file(`${repo.path}/tests-started`).exists());
});

testStable.each([
  {
    script: 'gen:check',
    required: ['//#gen:theme:check', '@study/db#gen:check'],
    excluded: ['@study/server#test', '@study/client#test']
  },
  {
    script: 'frontend-check',
    required: ['@study/client#build', '@study/client#test', '@study/client#e2e'],
    excluded: ['@study/server#test', '@study/desktop#test']
  },
  {
    script: 'server-check',
    required: ['@study/server#typecheck', '@study/server#test', '@study/db#test'],
    excluded: ['@study/client#e2e', '@study/client#test']
  },
  {
    script: 'landing-check',
    required: ['//#check:landing'],
    excluded: ['@study/server#test', '@study/client#test']
  }
])(
  '$script selects its verification scope through Turbo',
  async ({ script, required, excluded }) => {
    await using repo = await fixture();
    const result = await repo.script(script, '--dry=json');

    assert.equal(result.code, 0, result.stderr);
    const plan: Plan = JSON.parse(result.stdout);
    const ids = plan.tasks.map((task) => task.taskId);

    assert.includeMembers(ids, required);
    assert.isEmpty(ids.filter((id) => excluded.includes(id)));
  }
);

testStable(
  'Turbo selects dirty, untracked, staged and renamed packages plus their consumers',
  async () => {
    await using repo = await fixture();

    assert.isEmpty((await repo.plan('check', '--affected')).tasks);
    await Bun.write(`${repo.path}/packages/ui/src/input.ts`, 'changed');
    let ids = (await repo.plan('check', '--affected')).tasks.map((task) => task.taskId);

    assert.includeMembers(ids, ['@study/ui#test', '@study/client#e2e', '//#check:global']);
    assert.notInclude(ids, '@study/desktop#check', JSON.stringify(ids));
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

testStable.each([
  'SIGINT',
  'SIGTERM',
  ...(process.platform === 'win32' ? [] : ['SIGHUP' as const, 'SIGQUIT' as const])
] as const)(
  'a signal sent only to the task wrapper stops its native process group: %s',
  async (signal) => {
    await using repo = await fixture();
    const pkg = await Bun.file(`${repo.path}/apps/client/package.json`).json();

    pkg.scripts.hold = 'bun hold.ts';
    await Bun.write(`${repo.path}/apps/client/package.json`, JSON.stringify(pkg));
    await Bun.write(
      `${repo.path}/apps/client/hold.ts`,
      `await Bun.write('worker.pid', String(process.pid)); console.log('worker-ready'); setInterval(() => {}, 1000);`
    );
    await Bun.write(
      `${repo.path}/turbo.json`,
      JSON.stringify({ ...config, tasks: { ...config.tasks, hold: { cache: false } } })
    );
    const child = Bun.spawn(
      [
        'bun',
        `${root}tooling/scripts/development/turbo.ts`,
        'run',
        'hold',
        '--filter=@study/client',
        '--log-order=stream'
      ],
      {
        cwd: repo.path,
        env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true', TURBO_TELEMETRY_DISABLED: '1' },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    );
    const stderr = new Response(child.stderr).text();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let worker: number | undefined;

    onTestFinished(async () => {
      child.kill('SIGTERM');
      await child.exited;
      stopWorker(worker);
    });

    try {
      const reader = child.stdout.getReader();
      let output = '';

      while (!output.includes('worker-ready')) {
        const chunk = await reader.read();

        assert.equal(chunk.done, false, output);
        output += new TextDecoder().decode(chunk.value);
      }

      const remaining = (async () => {
        while (!(await reader.read()).done) {}

        reader.releaseLock();
      })();

      worker = Number(await Bun.file(`${repo.path}/apps/client/worker.pid`).text());

      child.kill(signal);
      const code = await Promise.race([
        child.exited,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Wrapper did not stop')), 5000);
        })
      ]);

      assert.strictEqual(code, { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGQUIT: 131 }[signal]);
      assert.throws(() => process.kill(worker!, 0));
      await Promise.all([remaining, stderr]);
    } finally {
      clearTimeout(timeout);
      child.kill('SIGTERM');
      await child.exited;
      stopWorker(worker);
    }
  }
);

function stopWorker(pid: number | undefined): void {
  if (pid === undefined) return;

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;

    throw error;
  }
}
