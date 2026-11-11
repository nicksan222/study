import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';
import { assert, expect } from 'vite-plus/test';

const { dirname, join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

export const root = Bun.fileURLToPath(new URL('../../../../', import.meta.url));

const vp = join(root, 'node_modules/.bin/vp');

const oxlint = join(
  dirname(Bun.resolveSync('oxlint/package.json', dirname(Bun.resolveSync('vite-plus', root)))),
  'bin/oxlint'
);

export const pluginPath = 'tooling/oxc-config/plugin';

type Diagnostic = {
  code: string;
  filename: string;
  message: string;
};

async function writeManifests(
  directory: string,
  manifests: Record<string, unknown>
): Promise<void> {
  for (const name of ['contracts', 'ui', 'theme', 'localization', 'db', 'ai', 'server', 'web']) {
    const workspace = ['server', 'web'].includes(name) ? 'apps' : 'packages';
    const path = join(directory, workspace, name, 'package.json');

    await Effect.runPromise(fs.makeDirectory(dirname(path), { recursive: true }));

    if (name in manifests) await Bun.write(path, JSON.stringify({ exports: manifests[name] }));
    else if (await Bun.file(join(root, workspace, name, 'package.json')).exists())
      await Effect.runPromise(fs.copyFile(join(root, workspace, name, 'package.json'), path));
  }
}

async function writeSources(files: Record<string, string>, directory: string): Promise<void> {
  for (const [name, source] of Object.entries(files)) {
    const filename = join(directory, name);

    await Effect.runPromise(fs.makeDirectory(dirname(filename), { recursive: true }));
    await Bun.write(filename, source);
  }
}

async function preparePlugin(
  directory: string,
  manifests?: Record<string, unknown>
): Promise<string> {
  if (!manifests) return join(root, pluginPath, 'index.ts');

  await Effect.runPromise(
    fs.makeDirectory(join(directory, 'tooling/oxc-config'), { recursive: true })
  );
  await Effect.runPromise(fs.copy(join(root, pluginPath), join(directory, pluginPath)));
  await Effect.runPromise(fs.symlink(join(root, 'node_modules'), join(directory, 'node_modules')));
  await writeManifests(directory, manifests);

  return join(directory, pluginPath, 'index.ts');
}

async function runLint(
  directory: string,
  server: string,
  plugin: string,
  rule?: string,
  workspace = false
): Promise<Diagnostic[]> {
  const config = join(directory, 'oxlintrc.json');

  if (rule)
    await Bun.write(
      config,
      JSON.stringify({
        jsPlugins: [{ name: 'study', specifier: plugin }],
        categories: { correctness: 'off' },
        rules: { [`study/${rule}`]: 'error' }
      })
    );

  const paths: string[] = [];

  for (const name of ['packages', 'apps']) {
    const path = join(directory, name);

    if (await Effect.runPromise(fs.exists(path))) paths.push(path);
  }

  const result = Bun.spawnSync(
    [
      process.execPath,
      rule ? oxlint : vp,
      ...(rule ? [] : ['lint']),
      '--config',
      rule ? config : join(root, 'vite.config.ts'),
      '--no-ignore',
      '--format',
      'json',
      ...(workspace ? paths : [server])
    ],
    { cwd: root }
  );
  const stderr = result.stderr.toString();
  const stdout = result.stdout.toString();

  assertLintStatus(result.exitCode, stderr, stdout);
  const output = JSON.parse(stdout) as { diagnostics: Diagnostic[] };

  assert.strictEqual(result.exitCode, output.diagnostics.length ? 1 : 0, stderr);

  return output.diagnostics;
}

export async function lintFiles(
  files: Record<string, string>,
  rule?: string,
  workspace = false,
  manifests?: Record<string, unknown>
): Promise<Diagnostic[]> {
  const directory = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'oxlint-quality-' }));
  const server = join(directory, 'apps/server');

  try {
    await writeSources(files, workspace ? directory : server);
    const plugin = await preparePlugin(directory, manifests);

    return await runLint(directory, server, plugin, rule, workspace);
  } finally {
    await Effect.runPromise(fs.remove(directory, { recursive: true, force: true }));
  }
}

export function lintRule(
  rule: string,
  files: Record<string, string>,
  workspace = false,
  manifests?: Record<string, unknown>
): Promise<Diagnostic[]> {
  return lintFiles(files, rule, workspace, manifests);
}

/** Run workspace fixtures through the shared runner and retain their supplied paths. */
export async function lintRulePaths(
  rule: string,
  files: Record<string, string>
): Promise<string[]> {
  const paths = Object.keys(files).sort((a, b) => b.length - a.length);

  return (await lintRule(rule, files, true))
    .map(({ filename }) => {
      const path = paths.find((candidate) => filename.endsWith(`/${candidate}`));

      assert.ok(path, filename);

      return path;
    })
    .sort();
}

export function checkWiring(
  rules: string[],
  configured: Record<string, unknown>,
  testFiles: string[],
  overrides: Record<string, unknown>[] = []
): void {
  for (const rule of rules) {
    assert.strictEqual(
      configured[`study/${rule}`],
      'error',
      `study/${rule} must be enabled as an error`
    );
    assert.ok(testFiles.includes(`${rule}.test.ts`), `missing test for study/${rule}`);
  }

  for (const entries of [configured, ...overrides]) {
    for (const [name, severity] of Object.entries(entries)) {
      if (!name.startsWith('study/')) continue;

      assert.ok(rules.includes(name.slice('study/'.length)), `unknown rule ${name}`);
      assert.strictEqual(
        Array.isArray(severity) ? severity[0] : severity,
        'error',
        `${name} must remain an error`
      );
    }
  }
}

export function assertDiagnostics(
  rule: string,
  diagnostics: Diagnostic[],
  expected: [string, string][]
): void {
  expect(
    diagnostics
      .map(({ code, filename, message }) => {
        assert.strictEqual(code, `study(${rule})`);
        const marker = '/apps/server/';

        assert.ok(filename.includes(marker), filename);

        return [filename.split(marker)[1], message];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  ).toStrictEqual(expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function assertLintStatus(status: number | null, stderr: string, stdout: string): void {
  assert.ok(status === 0 || status === 1, stderr || stdout);
}
