import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const contractMessage =
  'Declare endpoints as export const run = publicProcedure.input(schema).query/mutation/subscription(handler), and compose routers from imported endpoints or routers.';

const builderMessage = 'Create the tRPC builder only in runtime/trpc.ts.';

const barrelMessage =
  'Procedure modules must not re-export values with export *; export helpers explicitly.';

const prefix = "import { publicProcedure as procedure, router } from '#backend/runtime/trpc';\n";

const cases: { name: string; path: string; source: string; messages: string[] }[] = [
  {
    name: 'accepts query endpoint',
    path: 'src/procedures/x/good.ts',
    source: prefix + 'export const run = procedure.input(schema).query(handler);\n',
    messages: []
  },
  {
    name: 'accepts mutation endpoint',
    path: 'src/procedures/x/mutation.ts',
    source: prefix + 'export const run = procedure.input(schema).mutation(handler);\n',
    messages: []
  },
  {
    name: 'accepts subscription endpoint',
    path: 'src/procedures/x/subscription.ts',
    source: prefix + 'export const run = procedure.input(schema).subscription(handler);\n',
    messages: []
  },
  {
    name: 'accepts helper exports',
    path: 'src/procedures/x/helper.ts',
    source: 'export const schema = {};\nexport type Value = string;\n',
    messages: []
  },
  {
    name: 'rejects endpoint without input',
    path: 'src/procedures/x/missing-input.ts',
    source: prefix + 'export const run = procedure.query(handler);\n',
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'rejects wrong endpoint export',
    path: 'src/procedures/x/wrong-export.ts',
    source: prefix + 'export const other = procedure.input(schema).query(handler);\n',
    messages: [contractMessage]
  },
  {
    name: 'rejects aliased endpoint export',
    path: 'src/procedures/x/alias.ts',
    source:
      prefix +
      'const endpoint = procedure.input(schema).query(handler);\nexport { endpoint as run };\n',
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'rejects default endpoint export',
    path: 'src/procedures/x/default.ts',
    source: prefix + 'export default procedure.input(schema).query(handler);\n',
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'rejects multiple endpoints',
    path: 'src/procedures/x/multiple.ts',
    source:
      prefix +
      'export const run = procedure.input(schema).query(handler);\nexport const other = procedure.input(schema).mutation(handler);\n',
    messages: [contractMessage]
  },
  {
    name: 'rejects inline router endpoint',
    path: 'src/procedures/x/router.ts',
    source:
      prefix + 'export const xRouter = router({ bad: procedure.input(schema).query(handler) });\n',
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'rejects aliased procedure builder',
    path: 'src/procedures/x/alias-builder.ts',
    source:
      prefix + 'const alias = procedure;\nexport const run = alias.input(schema).query(handler);\n',
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'rejects namespace procedure builder',
    path: 'src/procedures/x/namespace-builder.ts',
    source:
      "import * as trpc from '#backend/runtime/trpc';\nexport const run = trpc.publicProcedure.input(schema).query(handler);\n",
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'rejects local router handler',
    path: 'src/procedures/y/router.ts',
    source: prefix + 'const handler = () => 1;\nexport const yRouter = router({ handler });\n',
    messages: [contractMessage, contractMessage]
  },
  {
    name: 'accepts imported router endpoint',
    path: 'src/procedures/z/router.ts',
    source:
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from './endpoint';\nexport const zRouter = router({ endpoint });\n",
    messages: []
  },
  {
    name: 'rejects alternate builder import',
    path: 'src/procedures/x/alternative.ts',
    source:
      "import { initTRPC as init } from '@trpc/server';\nexport const value = init.create();\n",
    messages: [builderMessage]
  },
  {
    name: 'rejects namespace builder creation',
    path: 'src/procedures/x/namespace.ts',
    source: "import * as trpc from '@trpc/server';\nexport const value = trpc.initTRPC.create();\n",
    messages: [builderMessage]
  },
  {
    name: 'rejects additional endpoint export',
    path: 'src/procedures/a/aliased-export.ts',
    source:
      "import { publicProcedure } from '#backend/runtime/trpc';\nexport const run = publicProcedure.input(schema).query(handler);\nexport { run as other };\n",
    messages: [contractMessage]
  },
  {
    name: 'rejects endpoint reexport under another name',
    path: 'src/procedures/a/reexport.ts',
    source: "export { run as other } from './endpoint';\n",
    messages: [contractMessage]
  },
  {
    name: 'rejects destructured builder',
    path: 'src/procedures/a/destructure.ts',
    source:
      "import * as trpc from '@trpc/server';\nconst { initTRPC } = trpc;\nexport const value = initTRPC.create();\n",
    messages: [builderMessage]
  },
  {
    name: 'rejects computed builder access',
    path: 'src/procedures/a/computed.ts',
    source:
      "import * as trpc from '@trpc/server';\nexport const value = trpc['initTRPC'].create();\n",
    messages: [builderMessage]
  },
  {
    name: 'accepts shadowed builder binding',
    path: 'src/procedures/a/shadow.ts',
    source:
      "import { publicProcedure } from '#backend/runtime/trpc';\nexport const run = publicProcedure.input(schema).query(handler);\nexport function helper(publicProcedure: { value: number }) { return publicProcedure.value; }\n",
    messages: []
  },
  {
    name: 'rejects computed router key',
    path: 'src/procedures/b/router.ts',
    source:
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from './endpoint';\nexport const bRouter = router({ [sideEffect()]: endpoint });\n",
    messages: [contractMessage]
  },
  {
    name: 'rejects unrelated router import',
    path: 'src/procedures/c/router.ts',
    source:
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from '#backend/shared/helper';\nexport const cRouter = router({ endpoint });\n",
    messages: [contractMessage]
  },
  {
    name: 'accepts sibling router import',
    path: 'src/procedures/d/router.ts',
    source:
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from './endpoint';\nexport const dRouter = router({ endpoint });\n",
    messages: []
  }
];

for (const { name, path, source, messages } of cases) {
  test(`contract ${name}`, () => {
    const diagnostics = lintRule('procedure-contract', { [path]: source });

    assertDiagnostics(
      'procedure-contract',
      diagnostics,
      messages.map((message) => [path, message])
    );
  });
}

test('value wildcard barrels cannot expose an endpoint through a router', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/procedures/example/endpoint.ts':
      "import { publicProcedure } from '#backend/runtime/trpc';\nexport const run = publicProcedure.input(schema).query(handler);\n",
    'src/procedures/example/endpoint.test.ts': 'export {};\n',
    'src/procedures/example/barrel.ts': "export * from './endpoint';\n",
    'src/procedures/example/types.ts': "export type * from './endpoint';\n",
    'src/procedures/example/router.ts':
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from './barrel';\nexport const exampleRouter = router({ endpoint });\n"
  });

  assertDiagnostics('procedure-contract', diagnostics, [
    ['src/procedures/example/barrel.ts', barrelMessage]
  ]);
});

test('accepts the canonical folder contract and explicit non-object schemas', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/procedures/example/read/index.ts':
      "export { run } from './procedure.ts';\nexport type { Input } from './input.ts';\nexport { type Output } from './output.ts';\n",
    'src/procedures/example/read/procedure.ts':
      "import { publicProcedure } from '#backend/runtime/trpc';\nimport { inputValidator } from './input.ts';\nimport { outputValidator } from './output.ts';\nexport const run = publicProcedure.input(inputValidator).output(outputValidator).query(() => []);\n",
    'src/procedures/example/read/input.ts':
      "import { Schema } from 'effect';\nexport const inputSchema = Schema.Struct({});\nexport type Input = typeof inputSchema.Type;\nexport const inputValidator = Schema.toStandardSchemaV1(inputSchema);\n",
    'src/procedures/example/read/output.ts':
      "import { Schema } from 'effect';\nexport const outputSchema = Schema.Array(Schema.String);\nexport type Output = typeof outputSchema.Type;\nexport const outputValidator = Schema.toStandardSchemaV1(outputSchema);\n"
  });

  assertDiagnostics('procedure-contract', diagnostics, []);
});

test('endpoint indexes require canonical run, Input, and Output exports through the CLI', () => {
  const procedure =
    "import { publicProcedure } from '#backend/runtime/trpc';\nimport { inputValidator } from './input.ts';\nimport { outputValidator } from './output.ts';\nexport const run = publicProcedure.input(inputValidator).output(outputValidator).query(() => []);\n";
  const input =
    "import { Schema } from 'effect';\nexport const inputSchema = Schema.Struct({});\nexport type Input = typeof inputSchema.Type;\nexport const inputValidator = Schema.toStandardSchemaV1(inputSchema);\n";
  const output =
    "import { Schema } from 'effect';\nexport const outputSchema = Schema.Array(Schema.String);\nexport type Output = typeof outputSchema.Type;\nexport const outputValidator = Schema.toStandardSchemaV1(outputSchema);\n";
  const diagnostics = lintRule('procedure-contract', {
    'src/procedures/example/missing-types/index.ts': "export { run } from './procedure.ts';\n",
    'src/procedures/example/missing-types/procedure.ts': procedure,
    'src/procedures/example/missing-types/input.ts': input,
    'src/procedures/example/missing-types/output.ts': output,
    'src/procedures/example/wrong-types/index.ts':
      "export { run } from './procedure.ts';\nexport type { Input as PublicInput } from './input.ts';\nexport type { Output } from './input.ts';\n",
    'src/procedures/example/wrong-types/procedure.ts': procedure,
    'src/procedures/example/wrong-types/input.ts': input,
    'src/procedures/example/wrong-types/output.ts': output,
    'src/procedures/example/helper/index.ts': 'export const helper = 1;\n',
    'src/procedures/example/valid/index.ts':
      "export { run } from './procedure.ts';\nexport type { Input } from './input.ts';\nexport { type Output } from './output.ts';\n",
    'src/procedures/example/valid/procedure.ts': procedure,
    'src/procedures/example/valid/input.ts': input,
    'src/procedures/example/valid/output.ts': output
  });

  assertDiagnostics('procedure-contract', diagnostics, [
    [
      'src/procedures/example/missing-types/index.ts',
      "Endpoint index.ts must export only { run } from './procedure.ts' and type { Input } from './input.ts' and type { Output } from './output.ts'."
    ],
    [
      'src/procedures/example/wrong-types/index.ts',
      "Endpoint index.ts must export only { run } from './procedure.ts' and type { Input } from './input.ts' and type { Output } from './output.ts'."
    ]
  ]);
});

test('folder endpoint boundaries reject implementation exports, missing validator chaining and unsafe schemas', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/procedures/example/bad-index/index.ts': "export { run, helper } from './procedure.ts';\n",
    'src/procedures/example/bad-index/procedure.ts':
      "import { publicProcedure } from '#backend/runtime/trpc';\nimport { inputValidator } from './input.ts';\nimport { outputValidator } from './output.ts';\nexport const run = publicProcedure.input(inputValidator).output(outputValidator).query(() => []);\n",
    'src/procedures/example/bad-index/input.ts':
      "import { Schema } from 'effect';\nexport const inputSchema = Schema.Struct({});\nexport type Input = typeof inputSchema.Type;\nexport const inputValidator = Schema.toStandardSchemaV1(inputSchema);\n",
    'src/procedures/example/bad-index/output.ts':
      "import { Schema } from 'effect';\nexport const outputSchema = Schema.Array(Schema.String);\nexport type Output = typeof outputSchema.Type;\nexport const outputValidator = Schema.toStandardSchemaV1(outputSchema);\n",
    'src/procedures/example/bad-procedure/procedure.ts':
      "import { publicProcedure } from '#backend/runtime/trpc';\nimport { inputValidator } from './input.ts';\nimport { outputValidator } from './output.ts';\nexport const run = publicProcedure.input(inputValidator).query(() => []);\n",
    'src/procedures/example/bad-schema/input.ts':
      "import { Schema } from 'effect';\nimport { projects } from '@study/db';\nexport const inputSchema = Schema.Struct({ value: Schema.Unknown, id: projects.$inferSelect.id });\nexport type Input = unknown;\nexport const inputValidator = Schema.toStandardSchemaV1(inputSchema);\n"
  });

  assert.deepEqual(
    diagnostics.map(({ message }) => message).sort(),
    [
      "Endpoint index.ts must export only { run } from './procedure.ts' and type { Input } from './input.ts' and type { Output } from './output.ts'.",
      'Declare endpoints as export const run = publicProcedure.input(schema).query/mutation/subscription(handler), and compose routers from imported endpoints or routers.',
      'Declare endpoints as export const run = publicProcedure.input(schema).query/mutation/subscription(handler), and compose routers from imported endpoints or routers.',
      'Input and output schemas must not depend on database or procedure implementation modules.',
      'Input/output schema modules must not use unknown placeholders.',
      'Input/output schemas must not derive API types from Drizzle inferred row types.',
      'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
    ].sort()
  );
});

test('folder routers must import the explicit endpoint index instead of an endpoint implementation', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/procedures/example/router.ts':
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from './folder';\nexport const exampleRouter = router({ endpoint });\n",
    'src/procedures/example/direct-router.ts':
      "import { router } from '#backend/runtime/trpc';\nimport { run as endpoint } from './folder/procedure.ts';\nexport const exampleRouter = router({ endpoint });\n",
    'src/procedures/example/folder/index.ts': "export { run } from './procedure.ts';\n"
  });

  assertDiagnostics('procedure-contract', diagnostics, [
    [
      'src/procedures/example/router.ts',
      'Declare endpoints as export const run = publicProcedure.input(schema).query/mutation/subscription(handler), and compose routers from imported endpoints or routers.'
    ],
    [
      'src/procedures/example/direct-router.ts',
      'Declare endpoints as export const run = publicProcedure.input(schema).query/mutation/subscription(handler), and compose routers from imported endpoints or routers.'
    ]
  ]);
});

test('shared DTO schema modules receive the same database and placeholder protections', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/shared/contracts/schemas.ts':
      "import * as Effect from 'effect';\nimport { users as table } from 'drizzle-orm/sqlite-core';\nexport const userSchema = Effect.Schema.Struct({ id: table.$inferSelect.id, value: Effect.Schema.Unknown });\n",
    'src/shared/contract-alias/schemas.ts':
      "import { Schema as S } from 'effect';\nexport const valueSchema = S.Any;\nexport const optionalSchema = S.optionalKey(S.String);\n",
    'src/shared/contract-shadow/schemas.ts':
      "import { Schema as S } from 'effect';\nexport function read(S: { Unknown: string }) { return S.Unknown; }\n",
    'src/shared/contract-submodule/schemas.ts':
      "import * as S from 'effect/Schema';\nexport const valueSchema = S['Unknown'];\n",
    'src/shared/contracts/helper.ts':
      "import * as Effect from 'effect';\nexport const value = Effect.Schema.Unknown;\n"
  });

  assertDiagnostics('procedure-contract', diagnostics, [
    [
      'src/shared/contracts/schemas.ts',
      'Input and output schemas must not depend on database or procedure implementation modules.'
    ],
    [
      'src/shared/contracts/schemas.ts',
      'Input/output schemas must not derive API types from Drizzle inferred row types.'
    ],
    [
      'src/shared/contracts/schemas.ts',
      'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
    ],
    [
      'src/shared/contract-alias/schemas.ts',
      'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
    ],
    [
      'src/shared/contract-alias/schemas.ts',
      'Use Schema.optional for Zod optional fields; Schema.optionalKey rejects explicit undefined.'
    ],
    [
      'src/shared/contract-submodule/schemas.ts',
      'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
    ]
  ]);
});

test('schema placeholder guards follow Effect Schema imports and destructuring bindings', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/shared/contracts/schemas.ts':
      "import { Schema as S } from 'effect';\nconst { Any: Unrestricted, Unknown } = S;\nexport { Unrestricted, Unknown };\n",
    'src/shared/contract-assignment/schemas.ts':
      "import * as Effect from 'effect';\nlet AnySchema;\n({ Any: AnySchema } = Effect.Schema);\nexport { AnySchema };\n",
    'src/shared/contract-submodule/schemas.ts':
      "import * as S from 'effect/Schema';\nconst { Unknown: Loose } = S;\nexport { Loose };\n",
    'src/shared/contract-optional-pattern/schemas.ts':
      "import { Schema } from 'effect';\nconst { optionalKey: optional } = Schema;\nexport { optional };\n",
    'src/shared/contract-optional/schemas.ts':
      "import { optionalKey as optional } from 'effect/Schema';\nexport { optional };\n",
    'src/shared/contract-reexport/schemas.ts':
      "export { Any as Placeholder } from 'effect/Schema';\n",
    'src/shared/contract-shadow/schemas.ts':
      "import { Schema as S } from 'effect';\nexport const value = S.String;\nexport function read(S: { Unknown: string }) { return S.Unknown; }\nconst { Any } = { Any: 'unrelated' };\n"
  });

  assertDiagnostics('procedure-contract', diagnostics, [
    [
      'src/shared/contracts/schemas.ts',
      'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
    ],
    [
      'src/shared/contract-assignment/schemas.ts',
      'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
    ],
    [
      'src/shared/contract-submodule/schemas.ts',
      'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
    ],
    [
      'src/shared/contract-optional-pattern/schemas.ts',
      'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
    ],
    [
      'src/shared/contract-optional/schemas.ts',
      'Use Schema.optional for Zod optional fields; Schema.optionalKey rejects explicit undefined.'
    ],
    [
      'src/shared/contract-reexport/schemas.ts',
      'Input/output schemas must not use Schema.Any or Schema.Unknown as placeholders.'
    ]
  ]);
});

test('schema destructuring guards read quoted keys without flagging shadowed namespaces', () => {
  const diagnostics = lintRule('procedure-contract', {
    'src/shared/quoted-declaration/schemas.ts':
      "import { Schema } from 'effect';\nconst { 'Any': A, 'Unknown': U, 'optionalKey': O } = Schema;\nexport { A, U, O };\n",
    'src/shared/quoted-assignment/schemas.ts':
      "import * as S from 'effect/Schema';\nlet A, U, O;\n({ 'Any': A, 'Unknown': U, 'optionalKey': O } = S);\nexport { A, U, O };\n",
    'src/shared/quoted-shadow/schemas.ts':
      "import { Schema } from 'effect';\nexport const value = Schema.String;\nexport function read(Schema: { Any: string }) { const { 'Any': value } = Schema; return value; }\n",
    'src/shared/quoted-unrelated/schemas.ts':
      "const { 'Unknown': value } = { Unknown: 'ordinary data' };\nexport { value };\n"
  });

  assertDiagnostics('procedure-contract', diagnostics, [
    [
      'src/shared/quoted-declaration/schemas.ts',
      'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
    ],
    [
      'src/shared/quoted-assignment/schemas.ts',
      'Input/output schemas must not destructure Schema.Any, Schema.Unknown, or Schema.optionalKey.'
    ]
  ]);
});
