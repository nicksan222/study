import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Pass the generator factory to defineService; the harness owns Effect.gen.';

test.unit.stable(
  'service construction keeps generator wrapping in the harness',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'definition-generators',
      await lintRule({ assert }, 'definition-generators', {
        'src/bad.ts': String.raw`import { Effect as E } from "effect";
import { defineService as service } from "#server/platform/definitions/define-service";
service(
  "x",
  E.gen(function* () {
    return {};
  }),
);
const make = E.gen(function* () {
  return {};
});
service("y", make);`,
        'src/good.ts': String.raw`import { Effect } from "effect";
import { defineService } from "#server/platform/definitions/define-service";
defineService("x", function* () {
  return {};
});
defineService("y", Effect.succeed({}));
function other(defineService: any) {
  defineService(
    "z",
    Effect.gen(function* () {
      return {};
    }),
  );
}`
      }),
      [
        ['src/bad.ts', message],
        ['src/bad.ts', message]
      ]
    );
  }
);

test.unit.stable(
  'RPC wiring uses named dependency binding and preserves shadowed functions',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'definition-generators',
      await lintRule({ assert }, 'definition-generators', {
        'src/bad.ts': String.raw`import { defineRpc as rpc } from "#server/platform/definitions/define-rpc";
rpc(group, handlers);`,
        'src/good.ts': String.raw`import { defineRpc as rpc } from "#server/platform/definitions/define-rpc";
rpc(group, { service }, ({ service }) => handlers);
function f(rpc: any) {
  rpc(group, handlers);
}`
      }),
      [
        [
          'src/bad.ts',
          'Bind RPC dependencies through defineRpc instead of hand-written Effect acquisition.'
        ]
      ]
    );
  }
);
