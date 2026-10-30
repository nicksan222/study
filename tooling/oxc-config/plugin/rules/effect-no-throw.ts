import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!effectProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Yield a typed failure instead of throwing StudyError inside an Effect generator.';
    const errors = new Set<any>();

    function effectGenerator(parent: any): boolean {
      while (parent) {
        if (
          ['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(
            parent.type
          )
        ) {
          if (!parent.generator) return false;

          const call = parent.parent;

          if (call?.type !== 'CallExpression') return false;

          const name = bindings.resolve(call.callee);

          if (
            name === 'Effect.gen' ||
            name === 'Effect.fn' ||
            (call.callee.type === 'CallExpression' &&
              bindings.resolve(call.callee.callee) === 'Effect.fn')
          )
            return true;

          return false;
        }

        parent = parent.parent;
      }

      return false;
    }

    return {
      ImportDeclaration(node) {
        bindings.imports(node);

        if (
          node.importKind === 'type' ||
          !/(?:shared\/errors(?:\/index)?|shared|@study\/contracts(?:\/errors)?)(?:\.ts)?$/.test(
            node.source.value
          )
        )
          return;

        for (const specifier of node.specifiers)
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'StudyError'
          )
            errors.add(specifier);
      },
      ThrowStatement(node) {
        if (
          node.argument?.type !== 'NewExpression' ||
          node.argument.callee.type !== 'Identifier' ||
          !errors.has(bindings.definition(node.argument.callee))
        )
          return;

        if (effectGenerator(node.parent)) context.report({ node, message });
      }
    };
  }
});
