/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep test resources, waiting and runner policy in shared tooling.                  │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents local process ownership, sleep-based waiting, temporary shell resources and     │
 * │ runner configuration in tests. Shared testing owners are exempt; runner imports and      │
 * │ custom testStable wrappers are restricted beyond test files too.                         │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // example.test.ts                                                                     │
 * │   import { spawnTestProcess } from '@study/testing/vitest';                              │
 * │   spawnTestProcess(['bun', 'server.ts']);                                                │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // example.test.ts                                                                     │
 * │   Bun.spawn(['bun', 'server.ts']);                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { imported, memberName } from '../lexical-bindings.ts';
import { bunOperation, namespaceImport } from '../process-operations.ts';
import { resolveValue } from './module-factories.ts';

function importedCall(context: any, node: any, source: RegExp, name: string): boolean {
  const value = resolveValue(context, node);

  return (
    imported(context, value, source, name) ||
    (memberName(value) === name &&
      namespaceImport(context, resolveValue(context, value.object), source))
  );
}

function localPolicy(context: any, node: any): boolean {
  if (importedCall(context, node, /^@testing-library\/(?:react|dom)$/, 'configure')) return true;

  const callee = resolveValue(context, node);

  return (
    callee?.type === 'MemberExpression' &&
    memberName(callee) === 'setConfig' &&
    importedCall(context, callee.object, /^(?:vite-plus\/test|vitest)$/, 'vi')
  );
}

function nestedRegistration(node: any): boolean {
  let owner = node.parent;

  while (owner) {
    if (
      owner.type === 'FunctionDeclaration' ||
      (['ArrowFunctionExpression', 'FunctionExpression'].includes(owner.type) &&
        owner.parent.type === 'VariableDeclarator')
    )
      return true;

    if (owner.type === 'Program') return false;

    owner = owner.parent;
  }

  return false;
}

export default defineRule({
  meta: {
    type: 'problem',
    messages: {
      resource: 'Use @study/testing/vitest for process and resource test helpers.',
      polling:
        'Use native waitFor or expect.poll through the shared testing policy, not sleep loops.',
      policy:
        'Configure test runners and async budgets in the shared testing tooling, not individual tests.',
      runner:
        'Test runners belong in tooling/testing; author ordinary tests with @study/testing/vitest.',
      registration:
        'Use the provided test registrations and native each/extend APIs instead of a custom test wrapper.'
    }
  },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const owner = /\/(?:packages\/testing|tooling\/testing)\//.test(path);
    const test =
      /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests)\/(?:testing|support|fixtures)(?:\/|[.])|\/src\/test\/|test-(?:support|utils)/.test(
        path
      );

    if (owner) return {};

    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!typeOnly && source && /^(?:vite-plus\/test\/node|vitest\/node)$/.test(source))
        context.report({ node, messageId: 'runner' });
    });

    return {
      ...edges,
      CallExpression(node) {
        edges.CallExpression(node);

        if (
          importedCall(context, node.callee, /^@study\/testing\/vitest$/, 'testStable') &&
          nestedRegistration(node)
        )
          context.report({ node, messageId: 'registration' });

        if (!test) return;

        const operation = bunOperation(context, node.callee);

        if (operation === 'spawn' || operation === 'spawnSync')
          context.report({ node, messageId: 'resource' });

        if (operation === 'sleep') context.report({ node, messageId: 'polling' });

        if (localPolicy(context, node.callee)) context.report({ node, messageId: 'policy' });
      },
      TaggedTemplateExpression(node) {
        if (
          test &&
          /\bmktemp\b/.test(node.quasi.quasis.map((part: any) => part.value.cooked ?? '').join(' '))
        )
          context.report({ node, messageId: 'resource' });
      }
    };
  }
});
