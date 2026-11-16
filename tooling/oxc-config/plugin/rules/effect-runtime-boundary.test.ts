import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Run Effects and construct ManagedRuntime only at approved application runtime boundaries.';

test.stable(
  'limits runtime execution to the approved scoped adapters',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-runtime-boundary',
      await lintRule({ assert }, 'effect-runtime-boundary', {
        'src/procedures/bad.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.runPromise(E.void);`,
        'src/procedures/good.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
export const task = E.succeed(1);
function f(E: any) {
  E.runPromise(1);
}`,
        'src/procedures/example.test.ts': String.raw`import { Effect as E } from "effect";
import { StudyError } from "@study/server/shared/errors";
E.runPromise(E.void);`
      }),
      [['src/procedures/bad.ts', message]]
    );
  }
);
test.stable(
  'resolves imported namespaces, named imports, const aliases and shadowing',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-runtime-boundary',
      await lintRule({ assert }, 'effect-runtime-boundary', {
        'src/procedures/aliases.ts': String.raw`import * as E from "effect/Effect";
import { runSync as operation } from "effect/Effect";
const alias = E;
alias.runSync(E.void);
operation(E.void);
function f(E: any, operation: any) {
  E.runSync(E.void);
  operation(E.void);
}`
      }),
      [
        ['src/procedures/aliases.ts', message],
        ['src/procedures/aliases.ts', message]
      ]
    );
  }
);

test.stable(
  'permits runtime adapters and tests but checks domain fixtures',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const code =
      "import { Effect as E, ManagedRuntime as M } from 'effect'; E.runPromise(E.void); M.make(layer);";

    assertDiagnostics(
      { assert, expect },
      'effect-runtime-boundary',
      await lintRule({ assert }, 'effect-runtime-boundary', {
        'src/runtime/main.ts': code,
        'test/testing/runtime.ts': code,
        'src/procedures/fixtures/runtime.ts': code
      }),
      [
        ['src/procedures/fixtures/runtime.ts', message],
        ['src/procedures/fixtures/runtime.ts', message]
      ]
    );
  }
);

test.stable(
  'requires the durable worker to use scoped fibers rather than execute a detached runtime',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-runtime-boundary',
      await lintRule({ assert }, 'effect-runtime-boundary', {
        'src/runtime/workers.ts': String.raw`import { Effect, Fiber } from "effect";
const fiber = Effect.runFork(task);
await Effect.runPromise(Fiber.interrupt(fiber));`
      }),
      [
        ['src/runtime/workers.ts', message],
        ['src/runtime/workers.ts', message]
      ]
    );
  }
);

test.stable(
  'target architecture limits execution and runtime construction to their explicit owners',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-runtime-boundary', {
      'src/runtime/request.ts': "import { Effect } from 'effect'; Effect.runPromise(task);",
      'src/runtime/layers.ts':
        "import { ManagedRuntime } from 'effect'; ManagedRuntime.make(layer);",
      'src/platform/ai/tool-adapter.ts':
        "import { Effect } from 'effect'; Effect.runPromise(tool);",
      'src/domains/jobs/runner.ts': "import { Effect } from 'effect'; Effect.runFork(poll);",
      'src/runtime/service.ts':
        "import { ManagedRuntime } from 'effect'; ManagedRuntime.make(layer);"
    });

    assertDiagnostics({ assert, expect }, 'effect-runtime-boundary', diagnostics, [
      ['src/runtime/request.ts', message],
      ['src/domains/jobs/runner.ts', message],
      ['src/runtime/service.ts', message]
    ]);
  }
);

test.stable(
  'context-taking runners stay at the scoped callback or synchronous observation bridge',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-runtime-boundary', {
      'src/domains/jobs/service.ts': String.raw`import { Effect } from "effect";
Effect.runSyncWith(context)(task);
Effect.runPromiseWith(context)(task);`,
      'src/platform/observability/index.ts': String.raw`import { Effect } from "effect";
Effect.runSyncWith(context)(task);
Effect.runPromise(task);`,
      'src/runtime/request.ts': "import {Effect} from 'effect'; Effect.runSyncWith(context)(task);"
    });

    assertDiagnostics({ assert, expect }, 'effect-runtime-boundary', diagnostics, [
      ['src/domains/jobs/service.ts', message],
      ['src/domains/jobs/service.ts', message],
      ['src/platform/observability/index.ts', message],
      ['src/runtime/request.ts', message]
    ]);
  }
);

test.stable(
  'only the exported HTTP Promise bridge can execute an HTTP Effect',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-runtime-boundary', {
      'src/platform/http/index.ts': `
      import { Effect as E } from 'effect';
      export function runHttpPromise(task) {
        const pending = E.runPromise(task);
        E.runSync(task);
        return pending;
      }
      function elsewhere(task) { return E.runPromise(task); }
    `,
      'src/platform/http/other.ts': `
      import { Effect } from 'effect';
      export function runHttpPromise(task) { return Effect.runPromise(task); }
    `
    });

    assertDiagnostics({ assert, expect }, 'effect-runtime-boundary', diagnostics, [
      ['src/platform/http/index.ts', message],
      ['src/platform/http/index.ts', message],
      ['src/platform/http/other.ts', message]
    ]);
  }
);

test.stable(
  'only the browser runtime adapter may execute browser operations',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const code =
      "import { Effect as E, ManagedRuntime as M } from 'effect'; E.runPromise(E.void); E.runPromiseExitWith(context)(E.void); M.make(layer);";
    const diagnostics = await lintRule(
      { assert },
      'effect-runtime-boundary',
      {
        'apps/client/src/features/example/page.logic.ts': code,
        'apps/client/src/lib/effect/runtime.ts': code,
        'apps/client/src/features/example/page.logic.test.ts': code
      },
      true
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.stable(
  'backup policy composition reuses the managed runtime instead of adding a synchronous runner',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-runtime-boundary', {
      'src/runtime/backups.ts':
        "import { Effect as E } from 'effect'; const run = E.runSync; run(prepare);",
      'src/runtime/composition.ts':
        "import { runNative } from '#server/runtime/layers'; runNative(prepare);"
    });

    assertDiagnostics({ assert, expect }, 'effect-runtime-boundary', diagnostics, [
      ['src/runtime/backups.ts', message]
    ]);
  }
);

test.stable(
  'only named filesystem bridges may run their corresponding Effects',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-runtime-boundary', {
      'src/platform/filesystem/index.ts': `
      import { Effect as E, ManagedRuntime } from 'effect';
      export function runFileSystemPromise(task) {
        E.runPromise(task);
        E.runSync(task);
        E.runFork(task);
        function nested() { E.runPromise(task); }
        return nested;
      }
      function runFileSystemSync(task) {
        E.runSync(task);
        E.runPromise(task);
        ManagedRuntime.make(task);
      }
      function privateRunner(task) { E.runSync(task); E.runPromise(task); }
      export const other = (task) => E.runPromise(task);
    `,
      'src/platform/filesystem/other.ts': `
      import { Effect } from 'effect';
      export function runFileSystemPromise(task) { return Effect.runPromise(task); }
      export function runFileSystemSync(task) { return Effect.runSync(task); }
    `,
      'src/features/example/service/index.ts': `
      import { Effect, ManagedRuntime } from 'effect';
      Effect.runPromise(task); Effect.runSync(task); Effect.runFork(task); ManagedRuntime.make(layer);
    `
    });

    assertDiagnostics({ assert, expect }, 'effect-runtime-boundary', diagnostics, [
      ...Array.from(
        { length: 8 },
        () => ['src/platform/filesystem/index.ts', message] as [string, string]
      ),
      ...Array.from(
        { length: 2 },
        () => ['src/platform/filesystem/other.ts', message] as [string, string]
      ),
      ...Array.from(
        { length: 4 },
        () => ['src/features/example/service/index.ts', message] as [string, string]
      )
    ]);
  }
);

test.stable(
  'filesystem sync acquisition remains private',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-runtime-boundary', {
      'src/platform/filesystem/index.ts': String.raw`import { Effect } from "effect";
export function runFileSystemSync(task) {
  return Effect.runSync(task);
}`
    });

    assertDiagnostics({ assert, expect }, 'effect-runtime-boundary', diagnostics, [
      ['src/platform/filesystem/index.ts', message]
    ]);
  }
);
