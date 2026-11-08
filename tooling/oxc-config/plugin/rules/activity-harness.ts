import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport } from '../architecture-imports.ts';
import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { imported } from '../lexical-bindings.ts';
import { property } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !serverProduction(context.filename) ||
      !context.filename.replaceAll('\\', '/').includes('/src/features/')
    )
      return {};

    const effects = effectBindings(context);

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        if (
          imported(
            context,
            node.callee,
            /^#server\/platform\/workflows\/retry$/,
            'retryResumableActivity'
          ) &&
          node.arguments[0]?.type === 'CallExpression' &&
          canonicalImport(context, node.arguments[0].callee, 'define-activity', 'defineActivity')
        )
          context.report({
            node,
            message:
              'Use resumableActivity to keep retry policy and checkpoint construction in one harness.'
          });

        if (canonicalImport(context, node.callee, 'define-activity', 'defineActivity')) {
          const execute = property(node.arguments[0], 'execute');

          if (
            execute?.type === 'CallExpression' &&
            imported(
              context,
              execute.callee,
              /^#server\/platform\/workflows\/publication$/,
              'withPublicationGuard'
            )
          )
            context.report({
              node,
              message:
                'Use publicationActivity to capture publication authority inside the checkpoint.'
            });
        }

        if (/^workflow[./]Activity\.make$/.test(effects.resolve(node.callee) ?? ''))
          context.report({
            node,
            message:
              'Declare feature checkpoints with defineActivity; the harness owns codecs and generator adaptation.'
          });
      }
    };
  }
});
