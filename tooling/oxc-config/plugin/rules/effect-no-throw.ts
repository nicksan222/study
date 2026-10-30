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

        let parent: any = node.parent;

        while (parent) {
          if (
            ['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(
              parent.type
            )
          ) {
            if (!parent.generator) return;

            const call = parent.parent;

            if (call?.type !== 'CallExpression') return;

            const name = bindings.resolve(call.callee);

            if (
              name === 'Effect.gen' ||
              name === 'Effect.fn' ||
              (call.callee.type === 'CallExpression' &&
                bindings.resolve(call.callee.callee) === 'Effect.fn')
            )
              context.report({ node, message });

            return;
          }

          parent = parent.parent;
        }
      }
    };
  }
});
