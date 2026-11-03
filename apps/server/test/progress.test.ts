/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks concise test results and failure-only file diagnostics.                   │
 * │                                                                                        │
 * │ Responsibilities:                                                                      │
 * │ - Exercises the real Node CLI with passing and failing files running together.         │
 * │                                                                                        │
 * │ Boundaries:                                                                            │
 * │ Uses public Node reporter events; CLI loading is covered by automatic fixture tests.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const reporter = fileURLToPath(new URL('./testing/progress.ts', import.meta.url));

for (const fails of [false, true]) {
  test(`progress keeps test results and ${fails ? 'shows failed' : 'hides passing'} file diagnostics`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'study-reporter-'));
    const fixture = join(directory, 'fixture.test.mjs');
    const passing = join(directory, 'passing.test.mjs');
    const env = { ...process.env };

    delete env.NODE_TEST_CONTEXT;

    try {
      writeFileSync(
        passing,
        `
        import { test } from 'node:test';
        test('other passing result', () => console.log('other passing output'));
      `
      );
      writeFileSync(
        fixture,
        `
        import { test } from 'node:test';
        test('visible test result', (t) => {
          console.log('fixture stdout');
          console.error('fixture stderr');
          t.diagnostic('fixture diagnostic');
          t.log('fixture phase');
          if (${fails}) throw new Error('intentional failure');
        });
      `
      );
      const child = spawnSync(
        process.execPath,
        ['--test', `--test-reporter=${reporter}`, fixture, passing],
        {
          encoding: 'utf8',
          env
        }
      );
      const output = child.stdout + child.stderr;

      assert.equal(child.status, fails ? 1 : 0, output);
      assert.match(output, /visible test result/);
      assert.match(output, /other passing result/);
      assert.doesNotMatch(output, /other passing output/);
      assert.doesNotMatch(output, /"event":"test:/);

      for (const message of [
        'fixture stdout',
        'fixture stderr',
        'fixture diagnostic',
        'fixture phase'
      ]) {
        if (fails) assert.ok(output.includes(message), output);
        else assert.ok(!output.includes(message), output);
      }

      if (fails) assert.match(output, /intentional failure/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
