import { defineRule } from 'vite-plus/lint/plugins';

import { importedValue } from '../architecture-imports.ts';
import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { resolveValue } from './module-factories.ts';

const platformServices = new Map([
  ['platform/database/database', 'Database'],
  ['platform/workflows/publication', 'PublicationGuard'],
  ['platform/workflows/control', 'WorkflowControl'],
  ['platform/ai/agents', 'Agents'],
  ['platform/ai/admission', 'AiAdmission'],
  ['features/materials/service/deletion', 'DeletionParticipants']
]);

export default defineRule({
  meta: { type: 'suggestion' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const effects = effectBindings(context);

    function service(node: any): boolean {
      const value = importedValue(context, node);

      if (value?.target) {
        if (platformServices.get(value.target) === value.name) return true;

        const feature = /^features\/([^/]+)\/(?:service\/index|index)$/.exec(value.target);

        if (
          feature &&
          value.name ===
            feature[1]!.replace(/(^|-)([a-z])/g, (_, _separator, letter) => letter.toUpperCase())
        )
          return true;
      }

      if (effects.resolve(node) === 'workflow.WorkflowEngine.WorkflowEngine') return true;

      const local = resolveValue(context, node);

      return (
        local?.type === 'CallExpression' && effects.resolve(local.callee) === 'Context.Service'
      );
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        if (
          effects.resolve(node.callee) === 'Effect.flatMap' &&
          node.arguments.length === 2 &&
          service(node.arguments[0])
        )
          context.report({
            node,
            message:
              'Use the native service.use callback instead of nesting Effect.flatMap around a service key.'
          });
      }
    };
  }
});
