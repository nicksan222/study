/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Delegate service generator wrapping and RPC dependency binding to definition       │
 * │ harnesses.                                                                               │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ In production server modules, prevents passing Effect.gen results to defineService and   │
 * │ two-argument defineRpc calls that leave dependency acquisition outside the harness.      │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { defineService } from '#server/platform/definitions/define-service';           │
 * │   defineService('study/X', function* () { return {}; });                                 │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { Effect } from 'effect';                                                       │
 * │   import { defineService } from '#server/platform/definitions/define-service';           │
 * │   defineService('study/X', Effect.gen(function* () { return {}; }));                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport } from '../architecture-imports.ts';
import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';

export default defineRule({
  meta: { type: 'suggestion' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const effects = effectBindings(context);

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        if (
          canonicalImport(context, node.callee, 'define-rpc', 'defineRpc') &&
          node.arguments.length === 2
        ) {
          context.report({
            node,
            message:
              'Bind RPC dependencies through defineRpc instead of hand-written Effect acquisition.'
          });
        }

        if (!canonicalImport(context, node.callee, 'define-service', 'defineService')) return;

        const make = resolveValue(context, node.arguments[1]);

        if (make?.type === 'CallExpression' && effects.resolve(make.callee) === 'Effect.gen')
          context.report({
            node: make,
            message: 'Pass the generator factory to defineService; the harness owns Effect.gen.'
          });
      }
    };
  }
});
