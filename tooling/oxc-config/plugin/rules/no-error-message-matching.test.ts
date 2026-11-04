import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { lintRule } from '../test/utils.ts';

testStable('no-error-message-matching guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('no-error-message-matching', {
    'src/bad.ts': "try { run(); } catch (error) { if (error.message.includes('busy')) retry(); }",
    'src/good.ts':
      "try { run(); } catch (error) { log(error.message); if (error.code === 'SQLITE_BUSY') retry(); }",
    'src/fixture.test.ts':
      "try { run(); } catch (error) { if (error.message.includes('busy')) retry(); }"
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('no-error-message-matching handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('no-error-message-matching', {
    'src/bad.ts':
      "try { run(); } catch (error) { switch (error.message) { case 'missing': break; } if (/busy/.test(error.message)) retry(); }",
    'src/good.ts':
      "try { run(); } catch (error) { const x = error instanceof Known ? { message: error.message } : classify(error); function nested(error) { if (error.message.includes('x')) run(); } }"
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('collection ambiguity and missing receipts branch on typed kinds', () => {
  const diagnostics = lintRule(
    'no-error-message-matching',
    {
      'apps/web/src/features/collections/unsafe.ts': `try { await create(); } catch (error) { if (error.message === 'invalid_input') release(); if (error.message.includes('not found')) close(); }`,
      'apps/web/src/features/collections/safe.ts': `try { await create(); } catch (error) { const kind = toStudyError(error).kind; if (kind === 'invalid_input') release(); if (kind === 'not_found') close(); }`
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/unsafe.ts')));
});
