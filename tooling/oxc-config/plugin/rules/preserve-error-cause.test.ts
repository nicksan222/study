import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable('preserves the caught error when wrapping it in a production Error', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/bad.ts': 'try { run(); } catch (error) { throw new Error(error.message); }',
    'src/good.ts': "try { run(); } catch (error) { throw new Error('failed', { cause: error }); }",
    'src/fixture.test.ts': 'try { run(); } catch (error) { throw new Error(error.message); }'
  });

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  test.assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test.stable('preserve-error-cause handles aliases and avoids unrelated bindings', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/bad.ts': `import { StudyError as Failure } from '#server/shared/errors/index';
 try { run();
 } catch (error) { throw new Failure('internal', error.message);
 }`,
    'src/good.ts': 'class Error {} try { run(); } catch (error) { throw new Error(error.message); }'
  });

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  test.assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test.stable('preserve-error-cause covers direct unsafe forms', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/bad.ts': "try { run(); } catch (cause) { throw new Error('operation failed'); }",
    'src/good.ts':
      "try { run(); } catch (cause) { if (!input.valid) throw new Error('input invalid'); throw cause; }"
  });

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  test.assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test.stable('canonical contracts error wrappers retain their original cause', async () => {
  const diagnostics = await lintRule('preserve-error-cause', {
    'src/domains/projects/service.ts': `import {StudyError} from '@study/contracts';
 try { work();
 } catch(error) { throw new StudyError('internal', 'failed');
 }`
  });

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
