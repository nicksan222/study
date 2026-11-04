import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable(
  'production code cannot import test resources and tests acquire apps through the owned harness',
  () => {
    const diagnostics = lintRule('harness-boundary', {
      'src/domains/projects/service.ts':
        "import { fixture } from '#testing/fixtures'; export { fixture };",
      'src/procedures/projects/procedure.test.ts':
        "import { Db } from '@study/db'; const db = Db.open(':memory:');",
      'src/domains/projects/store.test.ts':
        "import { App as A } from '#server/runtime/service'; const app = A.open({path: ':memory:'});",
      'test/testing/study-test.ts':
        "import { Db } from '@study/db'; const db = Db.open(':memory:');",
      'src/domains/projects/service.test.ts':
        "import { createStudyTest } from '#testing/study-test'; export { createStudyTest };",
      'src/domains/sources/pure.test.ts': 'const Db = { open() {} }; Db.open();'
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable(
  'resource ownership survives namespaces and constant aliases with lexical shadowing',
  () => {
    const diagnostics = lintRule('harness-boundary', {
      'src/domains/projects/store.test.ts':
        "import * as db from '@study/db'; const Alias=db.Db; Alias.open(':memory:'); db.Db.open(':memory:'); function f(Alias) { Alias.open(); }",
      'src/domains/jobs/runner.test.ts':
        "import {App} from '#server/runtime/service'; const Alias=App; Alias.open({path: ':memory:'});"
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable('relative namespace imports cannot open applications outside the harness', () => {
  const diagnostics = lintRule('harness-boundary', {
    'src/domains/projects/store.test.ts':
      "import {App} from '../../runtime/service'; App.open({});",
    'src/domains/sources/store.test.ts':
      "import * as runtime from '../../runtime/service.ts'; runtime.App.open({});"
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});
