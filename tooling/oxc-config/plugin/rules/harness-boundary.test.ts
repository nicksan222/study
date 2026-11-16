import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'public runtime exports and extracted open methods cannot bypass fixture ownership',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'harness-boundary', {
      'src/features/projects/service/public.test.ts': `import { App } from '@study/server/runtime'; App.open({ path });`,
      'src/features/projects/service/index.test.ts': `import * as runtime from '#server/runtime/index';
      const app = runtime.App; const open = app.open; open({ path });`,
      'src/features/projects/service/db.test.ts': `import { Db } from '@study/db';
      const { open } = Db; open(path);`,
      'src/features/projects/service/good.test.ts': `import { createServerFixture } from '@study/server/testing';
      await using fixture = await createServerFixture();`,
      'src/features/projects/service/index.ts': `export { createServerFixture } from '@study/server/testing';`
    });

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.stable(
  'production code cannot import test resources and tests acquire apps through the owned harness',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'harness-boundary', {
      'src/domains/projects/service.ts':
        "import { fixture } from '#testing/fixtures'; export { fixture };",
      'src/procedures/projects/procedure.test.ts':
        "import { Db } from '@study/db'; const db = Db.open(':memory:');",
      'src/domains/projects/store.test.ts': String.raw`import { App as A } from "#server/runtime/service";
const app = A.open({ path: ":memory:" });`,
      'test/testing/server-test.ts':
        "import { Db } from '@study/db'; const db = Db.open(':memory:');",
      'src/domains/projects/service.test.ts':
        "import { createServerTest } from '#testing/server-test'; export { createServerTest };",
      'src/domains/sources/pure.test.ts': 'const Db = { open() {} }; Db.open();'
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.stable(
  'resource ownership survives namespaces and constant aliases with lexical shadowing',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'harness-boundary', {
      'src/domains/projects/store.test.ts': String.raw`import * as db from "@study/db";
const Alias = db.Db;
Alias.open(":memory:");
db.Db.open(":memory:");
function f(Alias) {
  Alias.open();
}`,
      'src/domains/jobs/runner.test.ts': String.raw`import { App } from "#server/runtime/service";
const Alias = App;
Alias.open({ path: ":memory:" });`
    });

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.stable(
  'relative namespace imports cannot open applications outside the harness',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'harness-boundary', {
      'src/domains/projects/store.test.ts':
        "import {App} from '../../runtime/service'; App.open({});",
      'src/domains/sources/store.test.ts':
        "import * as runtime from '../../runtime/service.ts'; runtime.App.open({});"
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);
