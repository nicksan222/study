import { test } from '@study/testing';

import { lintFiles } from './utils.ts';

test.stable(
  'production config rejects four nested control-flow blocks',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintFiles(
      { assert },
      {
        'apps/client/src/lib/nesting.ts': `
      export function nested(a, b, c, d) {
        if (a) {
          if (b) {
            if (c) {
              if (d) {
                return 1;
              }
            }
          }
        }

        return 0;
      }
    `
      },
      undefined,
      true
    );

    assert.strictEqual(
      diagnostics.filter(({ code }) => code === 'eslint(max-depth)').length,
      1,
      JSON.stringify(diagnostics)
    );
  }
);

test.stable('production config rejects four nested callbacks', async ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const diagnostics = await lintFiles(
    { assert },
    {
      'apps/client/src/lib/callbacks.ts': `
      export function nested(items) {
        return items.map((a) =>
          items.map((b) =>
            items.map((c) =>
              items.map((d) => a + b + c + d)
            )
          )
        );
      }
    `
    },
    undefined,
    true
  );

  assert.strictEqual(
    diagnostics.filter(({ code }) => code === 'eslint(max-nested-callbacks)').length,
    1,
    JSON.stringify(diagnostics)
  );
});

test.stable(
  'production config accepts guard clauses and three callback levels',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintFiles(
      { assert },
      {
        'apps/client/src/lib/shallow.ts': `
      export function guarded(a, b, c) {
        if (!a) return 0;

        if (!b) return 0;

        if (!c) return 0;

        return 1;
      }

      export function callbacks(items) {
        return items.map((a) => items.map((b) => items.map((c) => a + b + c)));
      }
    `
      },
      undefined,
      true
    );

    expect(diagnostics).toStrictEqual([]);
  }
);
