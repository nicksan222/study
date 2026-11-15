/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Prepares one disposable environment for ordinary provider integration tests.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns setup output, test execution, report collection and cleanup.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Provider software runs without network or host profiles and credentials.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { fs, path, run } from './filesystem.ts';

/** Copy authored input only; never mount a checkout, host dependencies, credentials or test state. */
export async function buildContext(
  root = Bun.fileURLToPath(new URL('../../../', import.meta.url))
) {
  const directory = await run(fs.makeTempDirectory({ prefix: 'study-integrations-image-' }));
  const files = [
    'package.json',
    'bun.lock',
    'vite.config.ts',
    'packages',
    'apps/server',
    'tooling',
    'apps/client/package.json',
    'apps/desktop/package.json'
  ];

  try {
    const copy = async (relative: string): Promise<void> => {
      if (
        relative
          .split('/')
          .some(
            (part) =>
              [
                'node_modules',
                'target',
                'dist',
                '.git',
                '.turbo',
                'test-results',
                'playwright-report',
                'coverage',
                '.fallow',
                '__pycache__',
                '.astro',
                '.tanstack'
              ].includes(part) || part.startsWith('.env')
          )
      )
        return;

      const source = path.resolve(root, relative);
      const target = path.join(directory, relative);
      const info = await run(fs.lstat(source));

      if (info.type === 'Directory') {
        await run(fs.makeDirectory(target, { recursive: true }));

        for (const entry of await run(fs.readDirectory(source))) await copy(`${relative}/${entry}`);
      } else {
        await run(fs.makeDirectory(path.dirname(target), { recursive: true }));
        await run(fs.copy(source, target));
      }
    };

    for (const file of files) await copy(file);

    return directory;
  } catch (error) {
    await run(fs.remove(directory, { recursive: true, force: true }));

    throw error;
  }
}

/** Run the native provider suite once and retain its reports before disposing its environment. */
export async function runIntegrationTests(
  root = Bun.fileURLToPath(new URL('../../../', import.meta.url)),
  signal?: AbortSignal
) {
  const reports = path.join(root, 'tooling/test-results');
  const diagnostics = path.join(reports, 'integrations');

  await run(fs.remove(diagnostics, { recursive: true, force: true }));
  await run(fs.remove(path.join(reports, 'vitest/integrations.xml'), { force: true }));
  await run(fs.makeDirectory(diagnostics, { recursive: true }));
  const log = Bun.file(path.join(diagnostics, 'setup.log'));

  await Bun.write(log, '');

  const docker = async (
    args: string[],
    options: { cwd?: string; visible?: boolean; signal?: AbortSignal; check?: boolean } = {}
  ) => {
    const child = Bun.spawn(['docker', ...args], {
      cwd: options.cwd ?? root,
      env: process.env,
      stdin: 'ignore',
      stdout: options.visible ? 'inherit' : 'pipe',
      stderr: options.visible ? 'inherit' : 'pipe',
      signal: options.signal ?? AbortSignal.timeout(30000)
    });
    const read = (stream: typeof child.stdout) =>
      stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve('');
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      read(child.stdout),
      read(child.stderr)
    ]);

    await Bun.write(log, `${await log.text()}$ docker ${args.join(' ')}\n${stdout}${stderr}\n`);
    options.signal?.throwIfAborted();

    if (code !== 0 && options.check !== false)
      throw new Error(`Integration command failed (${args[0]}, exit ${code}). See ${log.name}`);

    return stdout;
  };

  await using resources = new AsyncDisposableStack();
  const directory = await buildContext(root);

  resources.defer(() => run(fs.remove(directory, { recursive: true, force: true })));
  const name = `study-integrations-${crypto.randomUUID()}`;
  const image = `study-integrations-e2e:${crypto.randomUUID()}`;
  const execution = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(900000)])
    : AbortSignal.timeout(900000);

  resources.defer(async () => {
    const existing = await docker(['images', '--quiet', '--filter', `reference=${image}`]);

    if (existing.trim()) await docker(['rmi', '--force', image]);
  });

  await docker(
    [
      'build',
      '--load',
      '--quiet',
      '--file',
      'tooling/testing/integrations/Dockerfile',
      '--tag',
      image,
      '.'
    ],
    { cwd: directory, signal: execution }
  );
  resources.defer(async () => {
    const existing = await docker(['ps', '--all', '--quiet', '--filter', `name=^/${name}$`]);

    if (existing.trim()) await docker(['rm', '--force', '--volumes', name]);
  });

  await docker(
    [
      'create',
      '--name',
      name,
      '--init',
      '--network',
      'none',
      '--tmpfs',
      '/run/study-test:rw,nosuid,nodev,mode=1777,size=256m',
      '--shm-size',
      '128m',
      '--env',
      'TMPDIR=/run/study-test',
      '--env',
      'STUDY_INTEGRATION_ENVIRONMENT=true',
      '--env',
      'CI=true',
      image,
      'xvfb-run',
      '-a',
      'bun',
      '--bun',
      'vp',
      'test',
      'run',
      '--config',
      'tooling/testing/integrations/vite.config.ts'
    ],
    { signal: execution }
  );
  resources.defer(() =>
    docker(['cp', `${name}:/workspace/tooling/test-results/.`, reports]).then(() => {})
  );
  resources.defer(() => docker(['stop', '--time', '5', name]).then(() => {}));

  // docker start attaches the runner's own output; inspect supplies its actual exit status.
  await docker(['start', '--attach', name], { visible: true, signal: execution, check: false });
  const output = await docker([
    'inspect',
    '--format',
    '{{.State.Status}} {{.State.ExitCode}}',
    name
  ]);
  const [status, value] = output.trim().split(/\s+/);
  const code = Number(value);

  if (
    status !== 'exited' ||
    value === undefined ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 255
  )
    throw new Error(`Integration runner returned an invalid exit status. See ${log.name}`);

  return code;
}
