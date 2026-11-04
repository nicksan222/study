import { testStable } from '@study/testing/node';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const catchAll = 'Effect.catchAll was removed in Effect v4; use Effect.catch.';

const catchCause = 'Effect.catchAllCause was removed in Effect v4; use Effect.catchCause.';

const catchDefect = 'Effect.catchAllDefect was removed in Effect v4; use Effect.catchDefect.';

const catchSome =
  'Effect.catchSome was removed in Effect v4; use Effect.catchFilter with a Filter.';

const tag = 'Context.Tag was removed in Effect v4; use Context.Service.';

const genericTag = 'Context.GenericTag was removed in Effect v4; use Context.Service.';

testStable('reports renamed v3 APIs through imported bindings', () => {
  const diagnostics = lintRule('effect-v4-api', {
    'src/root.ts':
      "import { Effect as E, Context as C } from 'effect';\nE.catchAll; E['catchAllCause']; E.catchAllDefect; E.catchSome; C.Tag; C.GenericTag;\n",
    'src/module.ts':
      "import * as E from 'effect/Effect';\nimport * as C from 'effect/Context';\nE.catchAll; C.Tag;\n",
    'src/direct.ts':
      "import { catchAll as recover } from 'effect/Effect';\nimport { GenericTag as make } from 'effect/Context';\nexport { recover, make };\n"
  });

  assertDiagnostics('effect-v4-api', diagnostics, [
    ['src/root.ts', catchAll],
    ['src/root.ts', catchCause],
    ['src/root.ts', catchDefect],
    ['src/root.ts', catchSome],
    ['src/root.ts', tag],
    ['src/root.ts', genericTag],
    ['src/module.ts', catchAll],
    ['src/module.ts', tag],
    ['src/direct.ts', catchAll],
    ['src/direct.ts', genericTag]
  ]);
});

testStable(
  'ignores shadowed bindings, unrelated properties, modern APIs and type-only imports',
  () => {
    const diagnostics = lintRule('effect-v4-api', {
      'src/safe.ts':
        "import { Effect as E, Context as C } from 'effect';\nimport type { catchAll as Old } from 'effect/Effect';\nE.catch; E.catchTag; C.Service;\nfunction f(E: { catchAll: number }, C: { Tag: number }) { return E.catchAll + C.Tag; }\nconst other = { catchAll: 1 }; other.catchAll;\nexport type T = Old;\nexport { f };\n"
    });

    assertDiagnostics('effect-v4-api', diagnostics, []);
  }
);

testStable(
  'reports selected APIs through root namespaces, direct reexports and destructuring',
  () => {
    const diagnostics = lintRule('effect-v4-api', {
      'src/namespace.ts':
        "import * as E from 'effect';\nE.Effect.catchAll; E['Context']['Tag'];\nconst { catchSome: recover } = E.Effect;\nconst { Context: { GenericTag: make } } = E;\n",
      'src/destructure.ts':
        "import { Effect as E } from 'effect';\nimport * as C from 'effect/Context';\nconst { ['catchAllCause']: recover } = E;\nconst { Tag: make } = C;\n",
      'src/reexport.ts':
        "export { catchAll as recover, catchSome } from 'effect/Effect';\nexport { GenericTag as make } from 'effect/Context';\n"
    });

    assertDiagnostics('effect-v4-api', diagnostics, [
      ['src/namespace.ts', catchAll],
      ['src/namespace.ts', tag],
      ['src/namespace.ts', catchSome],
      ['src/namespace.ts', genericTag],
      ['src/destructure.ts', catchCause],
      ['src/destructure.ts', tag],
      ['src/reexport.ts', catchAll],
      ['src/reexport.ts', catchSome],
      ['src/reexport.ts', genericTag]
    ]);
  }
);

testStable('ignores type-only reexports, unrelated and shadowed namespace destructures', () => {
  const diagnostics = lintRule('effect-v4-api', {
    'src/safe.ts':
      "import * as E from 'effect';\nexport type { catchAll } from 'effect/Effect';\nexport { type GenericTag } from 'effect/Context';\nfunction f(E: { Effect: { catchAll: number } }) { const { catchAll } = E.Effect; return E.Effect.catchAll + catchAll; }\nconst other = { Effect: { catchAll: 1 } }; const { catchAll } = other.Effect;\nE.Effect.catch; E.Effect.toString;\n"
  });

  assertDiagnostics('effect-v4-api', diagnostics, []);
});

testStable('reports destructuring assignments from tracked Effect namespaces', () => {
  const diagnostics = lintRule('effect-v4-api', {
    'src/assignment.ts':
      "import * as E from 'effect';\nimport * as C from 'effect/Context';\nlet recover, tag, generic;\n({ catchAll: recover } = E.Effect);\n({ Context: { ['Tag']: tag } } = E);\n({ GenericTag: generic } = C);\n",
    'src/safe-assignment.ts':
      "import * as E from 'effect';\nlet value;\nfunction f(E: { Effect: { catchAll: number } }) { ({ catchAll: value } = E.Effect); }\nconst other = { Effect: { catchAll: 1 } };\n({ catchAll: value } = other.Effect);\n({ catch: value } = E.Effect);\nexport { f };\n"
  });

  assertDiagnostics('effect-v4-api', diagnostics, [
    ['src/assignment.ts', catchAll],
    ['src/assignment.ts', tag],
    ['src/assignment.ts', genericTag]
  ]);
});

testStable('rejects retired forking, nullable and scoped layer constructors', () => {
  const diagnostics = lintRule('effect-v4-api', {
    'src/old.ts':
      "import { Effect, Option, Layer } from 'effect'; Effect.fork(work); Effect.forkDaemon(work); Option.fromNullable(value); Layer.scoped(Tag, acquire);",
    'src/direct.ts':
      "export { fromNullable } from 'effect/Option'; import * as Root from 'effect'; const { Layer: { scoped } } = Root;",
    'src/valid.ts':
      "import { Effect, Option, Layer } from 'effect'; Effect.forkChild(work); Effect.forkScoped(work); Option.fromNullishOr(value); Layer.effect(Tag, acquire); function f(Option: any) { return Option.fromNullable(value); }"
  });

  assertDiagnostics('effect-v4-api', diagnostics, [
    ['src/old.ts', 'Effect.fork was removed in Effect v4; use Effect.forkChild.'],
    [
      'src/old.ts',
      'Effect.forkDaemon was removed in Effect v4; use Effect.forkDetach only at the application root, otherwise Effect.forkScoped.'
    ],
    ['src/old.ts', 'Option.fromNullable was removed in Effect v4; use Option.fromNullishOr.'],
    ['src/old.ts', 'Layer.scoped was removed in Effect v4; use Layer.effect, which owns scoping.'],
    ['src/direct.ts', 'Option.fromNullable was removed in Effect v4; use Option.fromNullishOr.'],
    [
      'src/direct.ts',
      'Layer.scoped was removed in Effect v4; use Layer.effect, which owns scoping.'
    ]
  ]);
});
