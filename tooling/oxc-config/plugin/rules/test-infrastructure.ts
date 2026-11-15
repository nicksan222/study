import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { binding, imported, memberName } from '../lexical-bindings.ts';
import { resolveValue } from './module-factories.ts';

function bunOperation(context: any, callee: any): string | undefined {
  for (const name of ['spawn', 'spawnSync', 'sleep'])
    if (imported(context, resolveValue(context, callee), /^bun$/, name)) return name;

  const value = resolveValue(context, callee);

  if (value?.type !== 'MemberExpression') return;

  const owner = resolveValue(context, value.object);

  if (
    (owner?.type === 'Identifier' &&
      owner.name === 'Bun' &&
      !binding(context, owner)?.defs.length) ||
    namespace(context, owner, /^bun$/)
  )
    return memberName(value);
}

function namespace(context: any, node: any, source: RegExp): boolean {
  return (
    binding(context, node)?.defs.some(
      (definition: any) =>
        definition.node.type === 'ImportNamespaceSpecifier' &&
        source.test(definition.node.parent.source.value)
    ) ?? false
  );
}

function importedCall(context: any, node: any, source: RegExp, name: string): boolean {
  const value = resolveValue(context, node);

  return (
    imported(context, value, source, name) ||
    (memberName(value) === name && namespace(context, resolveValue(context, value.object), source))
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
      resource: 'Use @study/testing/process and @study/testing/resources for owned test resources.',
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
