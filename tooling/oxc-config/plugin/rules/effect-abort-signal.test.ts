import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Pass the Effect.tryPromise cancellation signal to fetch.';

test.unit.stable(
  'requires server fetches to preserve the shutdown signal',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-abort-signal', {
      'src/workers/unsafe.ts':
        "import { Effect as E } from 'effect'; E.tryPromise(() => fetch(url));",
      'src/workers/safe.ts': String.raw`import { Effect as E } from "effect";
E.tryPromise((signal) => fetch(url, { signal }));
E.tryPromise(() => arbitraryPromise());`,
      'src/workers/unsafe.test.ts':
        "import { Effect as E } from 'effect'; E.tryPromise(() => fetch(url));",
      'client/browser.ts': "import { Effect as E } from 'effect'; E.tryPromise(() => fetch(url));"
    });

    assertDiagnostics({ assert, expect }, 'effect-abort-signal', diagnostics, [
      ['src/workers/unsafe.ts', message]
    ]);
  }
);

test.unit.stable(
  'finds fetch aliases in object callbacks and return bodies',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-abort-signal', {
      'src/workers/example.ts': String.raw`import { tryPromise as attempt } from "effect/Effect";
import { fetch as request } from "undici";
const native = fetch;
attempt({
  try: () => {
    return request(url);
  },
  catch: (error) => error,
});
attempt(() => native(url));`
    });

    assertDiagnostics({ assert, expect }, 'effect-abort-signal', diagnostics, [
      ['src/workers/example.ts', message],
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'accepts object callbacks and native fetch aliases with signal',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-abort-signal', {
      'src/workers/example.ts': String.raw`import * as E from "effect/Effect";
const request = globalThis.fetch;
E.tryPromise({ try: (signal) => request(url, { signal }), catch: (error) => error });`
    });

    assertDiagnostics({ assert, expect }, 'effect-abort-signal', diagnostics, []);
  }
);

test.unit.stable(
  'ignores unrelated or shadowed fetch APIs',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-abort-signal', {
      'src/workers/example.ts': String.raw`import { Effect } from "effect";
function f(fetch) {
  return Effect.tryPromise(() => fetch(url));
}
Effect.tryPromise(() => other.fetch(url));`
    });

    assertDiagnostics({ assert, expect }, 'effect-abort-signal', diagnostics, []);
  }
);

test.unit.stable(
  'rejects a signal from an unrelated variable',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'effect-abort-signal', {
      'src/workers/example.ts': String.raw`import { Effect } from "effect";
const other = new AbortController();
Effect.tryPromise((signal) => fetch(url, { signal: other.signal }));`
    });

    assertDiagnostics({ assert, expect }, 'effect-abort-signal', diagnostics, [
      ['src/workers/example.ts', message]
    ]);
  }
);

test.unit.stable(
  'requires browser Effect operations to use the native cancellation signal',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule(
      { assert },
      'effect-abort-signal',
      {
        'apps/client/src/features/example/page.logic.ts':
          "import { Effect } from 'effect'; export const task = Effect.tryPromise(() => fetch(url));",
        'apps/client/src/features/example/page.logic.test.ts':
          "import { Effect } from 'effect'; export const task = Effect.tryPromise(() => fetch(url));"
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'propagates the signal from native callback bridges',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-abort-signal',
      await lintRule({ assert }, 'effect-abort-signal', {
        'src/bad.ts': String.raw`import { Effect as E } from "effect";
E.callback((resume, signal) => {
  fetch(url);
});
E.callback((resume, signal) => {
  fetch(url, { signal: other });
});`,
        'src/good.ts': String.raw`import { Effect as E } from "effect";
E.callback((resume, signal) => {
  fetch(url, { signal });
});
E.callback((resume) => {
  otherWork(resume);
});
function f(E: any) {
  E.callback(() => fetch(url));
}`
      }),
      [
        ['src/bad.ts', 'Pass the Effect.callback cancellation signal to fetch.'],
        ['src/bad.ts', 'Pass the Effect.callback cancellation signal to fetch.']
      ]
    );
  }
);

test.unit.stable(
  'retains cancellation checks for extracted bridge callbacks',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-abort-signal',
      await lintRule({ assert }, 'effect-abort-signal', {
        'src/bad.ts': String.raw`import { Effect } from "effect";
const request = (signal) => fetch(url);
Effect.tryPromise(request);`,
        'src/good.ts': String.raw`import { Effect } from "effect";
const request = (signal) => fetch(url, { signal });
Effect.tryPromise(request);`
      }),
      [['src/bad.ts', 'Pass the Effect.tryPromise cancellation signal to fetch.']]
    );
  }
);

test.unit.stable(
  'attributes nested fetches to their nearest native cancellation bridge',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'effect-abort-signal',
      await lintRule({ assert }, 'effect-abort-signal', {
        'src/good.ts': String.raw`import { Effect as E } from "effect";
E.callback((resume) => {
  resume(E.tryPromise((signal) => fetch(url, { signal })));
});
E.callback((resume) => {
  const inner = (signal) => fetch(url, { signal });
  resume(E.tryPromise(inner));
});`,
        'src/bad.ts': String.raw`import { Effect as E } from "effect";
E.callback((resume) => {
  resume(E.tryPromise((signal) => fetch(url)));
});`
      }),
      [['src/bad.ts', message]]
    );
  }
);
