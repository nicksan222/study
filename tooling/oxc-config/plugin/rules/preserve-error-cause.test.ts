import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.unit.stable(
  'preserves the caught error when wrapping it in a production Error',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'preserve-error-cause', {
      'src/bad.ts': 'try { run(); } catch (error) { throw new Error(error.message); }',
      'src/good.ts':
        "try { run(); } catch (error) { throw new Error('failed', { cause: error }); }",
      'src/fixture.test.ts': 'try { run(); } catch (error) { throw new Error(error.message); }'
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'preserve-error-cause handles aliases and avoids unrelated bindings',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'preserve-error-cause', {
      'src/bad.ts': `import { StudyError as Failure } from '#server/shared/errors/index';
 try { run();
 } catch (error) { throw new Failure('internal', error.message);
 }`,
      'src/good.ts':
        'class Error {} try { run(); } catch (error) { throw new Error(error.message); }'
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'preserve-error-cause covers direct unsafe forms',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'preserve-error-cause', {
      'src/bad.ts': "try { run(); } catch (cause) { throw new Error('operation failed'); }",
      'src/good.ts':
        "try { run(); } catch (cause) { if (!input.valid) throw new Error('input invalid'); throw cause; }"
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.unit.stable(
  'canonical contracts error wrappers retain their original cause',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'preserve-error-cause', {
      'src/domains/projects/service.ts': `import {StudyError} from '@study/contracts';
 try { work();
 } catch(error) { throw new StudyError('internal', 'failed');
 }`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);
