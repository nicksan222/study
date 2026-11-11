import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('preserve-error-cause guards production and accepts safe alternatives', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/bad.ts': 'try { run(); } catch (error) { throw new Error(error.message); }',
    'src/good.ts': "try { run(); } catch (error) { throw new Error('failed', { cause: error }); }",
    'src/fixture.test.ts': 'try { run(); } catch (error) { throw new Error(error.message); }'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('preserve-error-cause handles aliases and avoids unrelated bindings', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/bad.ts':
      "import { StudyError as Failure } from '#server/shared/errors/index'; try { run(); } catch (error) { throw new Failure('internal', error.message); }",
    'src/good.ts': 'class Error {} try { run(); } catch (error) { throw new Error(error.message); }'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('preserve-error-cause covers direct unsafe forms', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/bad.ts': "try { run(); } catch (cause) { throw new Error('operation failed'); }",
    'src/good.ts':
      "try { run(); } catch (cause) { if (!input.valid) throw new Error('input invalid'); throw cause; }"
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('canonical contracts error wrappers retain their original cause', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/domains/projects/service.ts':
      "import {StudyError} from '@study/contracts/errors'; try { work(); } catch(error) { throw new StudyError('internal', 'failed'); }"
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
