import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Yield a typed failure instead of throwing StudyError inside an Effect generator.';

test.stable(
  'reports thrown exceptions in Effect code and accepts typed failure constructors',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-no-throw',
      await lintRule({ assert }, 'effect-no-throw', {
        'src/procedures/bad.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.gen(function* () {
  throw new StudyError("bad");
});`,
        'src/procedures/good.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
function f() {
  throw new StudyError("bad");
}
E.gen(function* () {
  throw new Error("defect");
});`,
        'src/procedures/example.test.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.gen(function* () {
  throw new StudyError("bad");
});`
      }),
      [['src/procedures/bad.ts', message]]
    );
  }
);

test.stable(
  'limits domain throw checks to the nearest imported Effect generator',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-no-throw',
      await lintRule({ assert }, 'effect-no-throw', {
        'src/procedures/generators.ts': String.raw`import * as E from "effect/Effect";
import { StudyError as Failure } from "@study/server/shared/errors";
E.fn("task")(function* () {
  throw new Failure("bad");
});
E.gen(function* () {
  function nested() {
    throw new Failure("ordinary");
  }
});
function f(E: any) {
  E.gen(function* () {
    throw new Failure("ordinary");
  });
}
E.gen(function* () {
  class Failure {}
  throw new Failure();
});`
      }),
      [['src/procedures/generators.ts', message]]
    );
  }
);

test.stable(
  'canonical server error imports retain typed Effect failure enforcement',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-throw', {
      'src/bad.ts': String.raw`import { Effect } from "effect";
import { StudyError } from "#server/shared/errors/index";
const operation = Effect.gen(function* () {
  throw new StudyError("internal", "bad");
});`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.stable(
  'public contracts error imports preserve the same typed Effect failure boundary',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-no-throw', {
      'src/domains/projects/service.ts': String.raw`import { Effect } from "effect";
import { StudyError } from "@study/contracts";
Effect.gen(function* () {
  throw new StudyError("internal", "bad");
});`
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.stable(
  'reports thrown browser Effect failures and accepts typed errors',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'effect-no-throw',
      {
        'apps/client/src/features/example/page.logic.ts': String.raw`import { Effect } from "effect";
import { StudyError } from "@study/contracts";
export const task = Effect.gen(function* () {
  throw new StudyError("internal", "bad");
});`,
        'apps/client/src/features/example/page.logic.test.ts': String.raw`import { Effect } from "effect";
import { StudyError } from "@study/contracts";
export const task = Effect.gen(function* () {
  throw new StudyError("internal", "bad");
});`
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.stable(
  'keeps typed failures in native untraced generators',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-no-throw',
      await lintRule({ assert }, 'effect-no-throw', {
        'src/bad.ts': String.raw`import { Effect as E } from "effect";
import { StudyError as Failure } from "@study/contracts";
E.fnUntraced(function* () {
  throw new Failure("internal", "bad");
});
E.fnUntracedEager(function* () {
  throw new Failure("internal", "bad");
});`,
        'src/good.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/contracts";
E.fnUntraced(function* () {
  yield* E.fail(new StudyError("internal", "bad"));
});
E.fnUntraced(function* () {
  function nested() {
    throw new StudyError("internal", "sync");
  }
  throw new Error("defect");
});
function f(E: any) {
  E.fnUntraced(function* () {
    throw new StudyError("internal", "sync");
  });
}`
      }),
      [
        ['src/bad.ts', message],
        ['src/bad.ts', message]
      ]
    );
  }
);
