import { testStable } from '@study/testing/vitest';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message = 'Pass the generator factory to defineService; the harness owns Effect.gen.';

testStable('service construction keeps generator wrapping in the harness', () => {
  assertDiagnostics(
    'definition-generators',
    lintRule('definition-generators', {
      'src/bad.ts':
        "import { Effect as E } from 'effect'; import { defineService as service } from '#server/platform/definitions/define-service'; service('x', E.gen(function* () { return {}; })); const make = E.gen(function* () { return {}; }); service('y', make);",
      'src/good.ts':
        "import { Effect } from 'effect'; import { defineService } from '#server/platform/definitions/define-service'; defineService('x', function* () { return {}; }); defineService('y', Effect.succeed({})); function other(defineService: any) { defineService('z', Effect.gen(function* () { return {}; })); }"
    }),
    [
      ['src/bad.ts', message],
      ['src/bad.ts', message]
    ]
  );
});

testStable('RPC wiring uses named dependency binding and preserves shadowed functions', () => {
  assertDiagnostics(
    'definition-generators',
    lintRule('definition-generators', {
      'src/bad.ts':
        "import {defineRpc as rpc} from '#server/platform/definitions/define-rpc'; rpc(group, handlers);",
      'src/good.ts':
        "import {defineRpc as rpc} from '#server/platform/definitions/define-rpc'; rpc(group, {service}, ({service}) => handlers); function f(rpc: any) { rpc(group, handlers); }"
    }),
    [
      [
        'src/bad.ts',
        'Bind RPC dependencies through defineRpc instead of hand-written Effect acquisition.'
      ]
    ]
  );
});
