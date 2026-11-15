/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep server tests on real database and runtime dependencies.                       │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents dynamic mock-runner imports and object literals asserted into imported Db, App  │
 * │ or ServerContext types. Static mock API restrictions live in lint config.                │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/test/example.test.ts                                                    │
 * │   import { createTestDatabase } from '@study/db/testing';                                │
 * │   const database = await createTestDatabase();                                           │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/test/example.test.ts                                                    │
 * │   import type { Db } from '@study/db';                                                   │
 * │   const db = {} as Db;                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunPath } from '@effect/platform-bun';
import { Effect, Path } from 'effect';
import { defineRule } from 'vite-plus/lint/plugins';

import { boundSpecifier } from '../lexical-bindings.ts';

const { dirname, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const message =
  'Server tests must use real dependencies, not mock APIs or fabricated database contexts.';

const mockModules = new Set(['vitest', 'vite-plus/test', '@jest/globals', 'jest-mock']);

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (!/\/apps\/server\/(?:test\/|src\/.*\.test\.)/.test(filename)) return {};

    const namedTypes = new Map<string, any>();
    const namespaces = new Map<string, { types: readonly string[]; specifier: any }>();

    function ownedTypes(source: string): readonly string[] {
      if (source === '@study/db') return ['Db'];

      if (source === '@study/server/runtime' || source === '#server/runtime/index') return ['App'];

      if (source === '#server/runtime/context') return ['ServerContext'];

      if (source === '#server/runtime/service') return ['App'];

      if (!source.startsWith('.')) return [];

      const target = resolve(dirname(context.filename), source)
        .replaceAll('\\', '/')
        .replace(/\.(?:[cm]?[jt]s)$/, '');

      return relativeOwnedTypes(target);
    }

    function relativeOwnedTypes(target: string): readonly string[] {
      if (target.endsWith('/apps/server/src/runtime/context')) return ['ServerContext'];

      if (
        target.endsWith('/apps/server/src/runtime/service') ||
        target.endsWith('/apps/server/src/runtime/index')
      )
        return ['App'];

      if (target.endsWith('/packages/db/src/index') || target.endsWith('/packages/db/src/db'))
        return ['Db'];

      return [];
    }

    return {
      ImportDeclaration(node) {
        const types = ownedTypes(node.source.value);

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier')
            namespaces.set(specifier.local.name, { types, specifier });
          else if (specifier.type === 'ImportSpecifier') {
            const imported =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value;

            if (types.includes(imported)) namedTypes.set(specifier.local.name, specifier);
          }
        }
      },
      ImportExpression(node) {
        if (
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string' &&
          (mockModules.has(node.source.value) || node.source.value === 'node:test')
        )
          context.report({ node, message });
      },
      TSAsExpression(node) {
        if (
          node.typeAnnotation.type !== 'TSTypeReference' ||
          !(node.typeAnnotation.typeName.type === 'Identifier'
            ? boundSpecifier(
                context,
                node.typeAnnotation.typeName,
                namedTypes.get(node.typeAnnotation.typeName.name)
              )
            : node.typeAnnotation.typeName.type === 'TSQualifiedName' &&
              node.typeAnnotation.typeName.left.type === 'Identifier' &&
              namespaces
                .get(node.typeAnnotation.typeName.left.name)
                ?.types.includes(node.typeAnnotation.typeName.right.name) &&
              boundSpecifier(
                context,
                node.typeAnnotation.typeName.left,
                namespaces.get(node.typeAnnotation.typeName.left.name)?.specifier
              ))
        )
          return;

        let expression = node.expression;

        while (expression.type === 'TSAsExpression') expression = expression.expression;

        if (expression.type === 'ObjectExpression') context.report({ node, message });
      }
    };
  }
});
