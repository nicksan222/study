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

import { assert, expect } from 'vite-plus/test';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));

const vp = join(root, 'node_modules/.bin/vp');

export const pluginPath = 'tooling/oxc-config/plugin';

type Diagnostic = {
  code: string;
  filename: string;
  message: string;
};

function writeManifests(directory: string, manifests: Record<string, unknown>): void {
  for (const name of ['contracts', 'ui', 'theme', 'localization', 'db', 'ai', 'server', 'web']) {
    const workspace = ['server', 'web'].includes(name) ? 'apps' : 'packages';
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

    assert.isUndefined(result.error);
    assertLintStatus(result.status, result.stderr, result.stdout);

    const output = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };

    assert.strictEqual(result.status, output.diagnostics.length ? 1 : 0, result.stderr);

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

/** Run workspace fixtures through the shared runner and retain their supplied paths. */
export function lintRulePaths(rule: string, files: Record<string, string>): string[] {
  const paths = Object.keys(files).sort((a, b) => b.length - a.length);

  return lintRule(rule, files, true)
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
