import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));

const vp = join(root, 'node_modules/.bin/vp');

export const pluginPath = 'tooling/oxc-config/plugin';

type Diagnostic = {
  code: string;
  filename: string;
  message: string;
};

function writeManifests(directory: string, manifests: Record<string, unknown>): void {
  for (const name of ['contracts', 'ui', 'theme', 'localization', 'db', 'ai', 'server']) {
    const workspace = name === 'server' ? 'apps' : 'packages';
    const path = join(directory, workspace, name, 'package.json');

    mkdirSync(dirname(path), { recursive: true });

    if (name in manifests) writeFileSync(path, JSON.stringify({ exports: manifests[name] }));
    else if (existsSync(join(root, workspace, name, 'package.json')))
      cpSync(join(root, workspace, name, 'package.json'), path);
  }
}

function writeSources(files: Record<string, string>, directory: string): void {
  for (const [name, source] of Object.entries(files)) {
    const filename = join(directory, name);

    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, source);
  }
}

export function lintFiles(
  files: Record<string, string>,
  rule?: string,
  workspace = false,
  manifests?: Record<string, unknown>
): Diagnostic[] {
  const temporaryRoot = tmpdir();

  mkdirSync(temporaryRoot, { recursive: true });

  const directory = mkdtempSync(join(temporaryRoot, 'oxlint-quality-'));
  const server = join(directory, 'apps/server');

  try {
    writeSources(files, workspace ? directory : server);

    let plugin = join(root, pluginPath, 'index.ts');

    if (manifests) {
      mkdirSync(join(directory, 'tooling/oxc-config'), { recursive: true });
      cpSync(join(root, pluginPath), join(directory, pluginPath), {
        recursive: true
      });
      symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');

      writeManifests(directory, manifests);

      plugin = join(directory, pluginPath, 'index.ts');
    }

    const config = join(directory, 'oxlintrc.json');

    if (rule)
      writeFileSync(
        config,
        JSON.stringify({
          jsPlugins: [{ name: 'study', specifier: plugin }],
          categories: { correctness: 'off' },
          rules: { [`study/${rule}`]: 'error' }
        })
      );

    const result = spawnSync(
      rule ? join(root, 'node_modules/.bin/oxlint') : vp,
      [
        ...(rule ? [] : ['lint']),
        '--config',
        rule ? config : join(root, 'vite.config.ts'),
        '--no-ignore',
        '--format',
        'json',
        ...(workspace
          ? ['packages', 'apps'].map((name) => join(directory, name)).filter(existsSync)
          : [server])
      ],
      {
        cwd: root,
        encoding: 'utf8'
      }
    );

    assert.ifError(result.error);
    assertLintStatus(result.status, result.stderr, result.stdout);

    const output = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };

    assert.equal(result.status, output.diagnostics.length ? 1 : 0, result.stderr);

    return output.diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function lintRule(
  rule: string,
  files: Record<string, string>,
  workspace = false,
  manifests?: Record<string, unknown>
): Diagnostic[] {
  return lintFiles(files, rule, workspace, manifests);
}

export function checkWiring(
  rules: string[],
  configured: Record<string, unknown>,
  testFiles: string[],
  overrides: Record<string, unknown>[] = []
): void {
  for (const rule of rules) {
    assert.equal(configured[`study/${rule}`], 'error', `study/${rule} must be enabled as an error`);
    assert.ok(testFiles.includes(`${rule}.test.ts`), `missing test for study/${rule}`);
  }

  for (const entries of [configured, ...overrides]) {
    for (const [name, severity] of Object.entries(entries)) {
      if (!name.startsWith('study/')) continue;

      assert.ok(rules.includes(name.slice('study/'.length)), `unknown rule ${name}`);
      assert.equal(
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
  assert.deepEqual(
    diagnostics
      .map(({ code, filename, message }) => {
        assert.equal(code, `study(${rule})`);
        const marker = '/apps/server/';

        assert.ok(filename.includes(marker), filename);

        return [filename.split(marker)[1], message];
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
}

function assertLintStatus(status: number | null, stderr: string, stdout: string): void {
  assert.ok(status === 0 || status === 1, stderr || stdout);
}
