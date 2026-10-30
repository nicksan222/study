import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintFiles } from './utils.ts';

test('production config rejects four nested control-flow blocks', () => {
  const diagnostics = lintFiles(
    {
      'apps/web/src/lib/nesting.ts': `
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

  assert.equal(
    diagnostics.filter(({ code }) => code === 'eslint(max-depth)').length,
    1,
    JSON.stringify(diagnostics)
  );
});

test('production config rejects four nested callbacks', () => {
  const diagnostics = lintFiles(
    {
      'apps/web/src/lib/callbacks.ts': `
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

  assert.equal(
    diagnostics.filter(({ code }) => code === 'eslint(max-nested-callbacks)').length,
    1,
    JSON.stringify(diagnostics)
  );
});

test('production config accepts guard clauses and three callback levels', () => {
  const diagnostics = lintFiles(
    {
      'apps/web/src/lib/shallow.ts': `
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

  assert.deepEqual(diagnostics, []);
});
