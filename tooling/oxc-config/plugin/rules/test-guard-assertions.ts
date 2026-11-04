import { defineRule } from 'vite-plus/lint/plugins';

import { binding, constantDeclarator, enterNode, memberName } from '../lexical-bindings.ts';

const runners = /^(?:vitest|vite-plus\/test|bun:test|@study\/testing\/vitest)$/;

const tests = new Set([
  'test',
  'it',
  'testStable',
  'testRegression',
  'testMigration',
  'testCharacterization'
]);

const modifiers = new Set(['each', 'for', 'concurrent', 'sequential', 'only', 'skip', 'todo']);

const functions = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(context.filename)) return {};

    function importedRunner(definition: any): string | undefined {
      if (!runners.test(definition.parent.source.value)) return;

      if (definition.type === 'ImportNamespaceSpecifier') return '*';

      const name = definition.imported?.name ?? definition.imported?.value;

      return tests.has(name) ? name : undefined;
    }

    function identifierRunner(node: any, seen: Set<any>): string | undefined {
      const definition = binding(context, node)?.defs[0]?.node;

      if (definition?.parent?.type === 'ImportDeclaration') return importedRunner(definition);

      if (constantDeclarator(definition)) return runner(definition.init, seen);
    }

    function memberRunner(node: any, seen: Set<any>): string | undefined {
      const base = runner(node.object, seen);
      const name = memberName(node);

      if (!name) return;

      if (base === '*') return tests.has(name) ? name : undefined;

      return modifiers.has(name) ? base : undefined;
    }

    function runner(node: any, seen = new Set<any>()): string | undefined {
      if (!enterNode(node, seen)) return;

      switch (node.type) {
        case 'CallExpression':
          return runner(node.callee, seen);
        case 'MemberExpression':
          return memberRunner(node, seen);
        case 'Identifier':
          return identifierRunner(node, seen);
      }
    }

    function directTest(node: any): boolean {
      let current = node.parent;

      while (current && !functions.has(current.type)) current = current.parent;

      const call = current?.parent;

      return (
        call?.type === 'CallExpression' &&
        call.arguments.includes(current) &&
        tests.has(runner(call.callee) ?? '')
      );
    }

    function singleStatement(node: any): any {
      const parent = node.parent;

      if (parent?.type !== 'BlockStatement') return node;

      return parent.body.length === 1 ? parent : undefined;
    }

    function guard(node: any): any {
      const statement = singleStatement(node);
      const parent = statement?.parent;

      if (parent?.type !== 'IfStatement') return;

      if (parent.alternate) return;

      return parent.consequent === statement ? parent : undefined;
    }

    return {
      ReturnStatement(node) {
        if (!node.argument && guard(node) && directTest(node))
          context.report({
            node,
            message: 'Review silent early returns in test bodies; assert the expected condition.'
          });
      },
      ThrowStatement(node) {
        const value = node.argument;

        if (
          guard(node) &&
          value?.type === 'NewExpression' &&
          value.callee.type === 'Identifier' &&
          value.callee.name === 'Error' &&
          !binding(context, value.callee)?.defs.length &&
          directTest(node)
        )
          context.report({
            node,
            message: 'Prefer a test runner assertion to a manual failure guard.'
          });
      }
    };
  }
});
