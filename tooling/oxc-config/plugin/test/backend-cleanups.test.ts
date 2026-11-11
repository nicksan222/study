import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { header } from './file-description.ts';
import { lintFiles } from './utils.ts';

const cases = [
  {
    rule: 'array-type',
    bad: 'export type Values = Array<string>;',
    good: 'export type Values = string[];'
  }
];

for (const { rule, bad, good } of cases) {
  testStable(`backend cleanup policy rejects ${rule} regressions`, async () => {
    const diagnostics = await lintFiles({
      'src/platform/cleanup-bad.ts': `${header}\n\n${bad}\n`,
      'src/platform/cleanup-good.ts': `${header}\n\n${good}\n`
    });
    const violations = diagnostics.filter(({ code }) => code.endsWith(`(${rule})`));

    assert.strictEqual(violations.length, 1, JSON.stringify(diagnostics));
    assert.ok(violations[0]!.filename.endsWith('/cleanup-bad.ts'));
    assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/cleanup-good.ts')));
  });
}
