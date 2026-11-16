/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Requires canonical declarations and contract-derived schemas for feature agents.   │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Production server feature agent modules exporting raw agent objects or configuring       │
 * │ canonical defineAgent calls without filename-matching id, contract-derived input/output, │
 * │ tiny/medium/smart model, instructions and prompt. Spreads and per-agent limits are       │
 * │ rejected; runtime owns limits, while helper functions and literal exports remain         │
 * │ allowed.                                                                                 │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/src/features/pages/agents/page-transform.ts                             │
 * │   import { defineAgent } from '#server/platform/definitions/define-agent';               │
 * │   import { promptInputSchema } from '@study/contracts';                                  │
 * │   import { pageTransformOutputSchema } from '@study/contracts';                          │
 * │   export const agent = defineAgent({ id: 'page-transform', input: promptInputSchema,     │
 * │     output: pageTransformOutputSchema, model: 'medium',                                  │
 * │     instructions: 'Transform captured notes.', prompt: ({ prompt }) => prompt });        │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/src/features/pages/agents/page-transform.ts                             │
 * │   export const agent = { generate: async () => 'text' };                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { featureRole, importedValue, serverPath, targetPath } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { binding, constantDeclarator, enterNode } from '../lexical-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !serverPath(context.filename)?.startsWith('features/') ||
      featureRole(context.filename) !== 'agent' ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(context.filename)
    )
      return {};

    const effects = effectBindings(context);

    function target(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (node.type === 'Identifier') {
        const def = binding(context, node)?.defs[0]?.node;

        if (def?.type === 'ImportSpecifier')
          return (
            def.imported.name === 'defineAgent' &&
            targetPath(context.filename, def.parent.source.value) ===
              'platform/definitions/define-agent'
          );

        if (constantDeclarator(def)) return target(def.init, seen);
      }

      return targetNamespace(node);
    }

    function targetNamespace(node: any): boolean {
      if (
        node.type === 'MemberExpression' &&
        node.property.name === 'defineAgent' &&
        node.object.type === 'Identifier'
      ) {
        const def = binding(context, node.object)?.defs[0]?.node;

        return (
          def?.type === 'ImportNamespaceSpecifier' &&
          targetPath(context.filename, def.parent.source.value) ===
            'platform/definitions/define-agent'
        );
      }

      return false;
    }

    function unwrap(node: any, seen = new Set<any>()): any {
      if (!enterNode(node, seen)) return node;

      if (
        [
          'TSAsExpression',
          'TSSatisfiesExpression',
          'TSNonNullExpression',
          'ParenthesizedExpression'
        ].includes(node.type)
      )
        return unwrap(node.expression, seen);

      if (node.type === 'Identifier') {
        const def = binding(context, node)?.defs[0]?.node;

        if (constantDeclarator(def)) return unwrap(def.init, seen);
      }

      return node;
    }

    function canonical(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (
        [
          'TSAsExpression',
          'TSSatisfiesExpression',
          'TSNonNullExpression',
          'ParenthesizedExpression'
        ].includes(node.type)
      )
        return canonical(node.expression, seen);

      if (node.type === 'Identifier') return canonicalIdentifier(node, seen);

      if (node.type === 'ArrayExpression')
        return (
          node.elements.length > 0 &&
          node.elements.every((element: any) => canonical(element, new Set(seen)))
        );

      if (node.type === 'MemberExpression') return canonical(node.object, seen);

      if (node.type === 'CallExpression') return canonicalCall(node, seen);

      return false;
    }

    function canonicalIdentifier(node: any, seen: Set<any>): boolean {
      const def = binding(context, node)?.defs[0]?.node;

      if (
        def?.parent?.type === 'ImportDeclaration' &&
        /^@study\/contracts(?:\/|$)/.test(def.parent.source.value)
      )
        return true;

      if (constantDeclarator(def)) return canonical(def.init, seen);

      return false;
    }

    function canonicalCall(node: any, seen: Set<any>): boolean {
      if (
        node.callee.type === 'CallExpression' &&
        ['Schema.decodeTo', 'Schema.encodeTo'].includes(effects.resolve(node.callee.callee) ?? '')
      )
        return (
          canonical(node.callee.arguments[0], new Set(seen)) &&
          canonical(node.arguments[0], new Set(seen))
        );

      const name = effects.resolve(node.callee);

      if (name === 'Schema.Struct') return false;

      if (name?.startsWith('Schema.'))
        return node.arguments.some((arg: any) => canonical(arg, new Set(seen)));

      if (
        node.callee.type === 'MemberExpression' &&
        ['pipe', 'check'].includes(node.callee.property.name)
      )
        return canonical(node.callee.object, seen);

      return false;
    }

    function preparation(node: any): boolean {
      const value = importedValue(context, node);

      return (
        value?.target === 'platform/ai/context-preparation/index' &&
        value.name === 'defineContextPreparation'
      );
    }

    function checkExport(node: any, value: any): void {
      const init = unwrap(value);

      if (
        init &&
        ![
          'ArrowFunctionExpression',
          'FunctionExpression',
          'FunctionDeclaration',
          'Literal'
        ].includes(init.type) &&
        (init.type !== 'CallExpression' || (!target(init.callee) && !preparation(init.callee)))
      )
        context.report({
          node,
          message: 'Agent exports must use defineAgent or defineContextPreparation.'
        });
    }

    function invalidConfiguration(
      properties: any[],
      values: Map<any, any>,
      keys: Set<any>
    ): boolean {
      return (
        properties.some((p: any) => p.type === 'SpreadElement') ||
        !canonical(values.get('input')) ||
        !canonical(values.get('output')) ||
        (unwrap(values.get('id')) as any)?.value !==
          context.filename
            .replaceAll('\\', '/')
            .split('/')
            .at(-1)
            ?.replace(/(?:\.agent)?\.[^.]+$/, '') ||
        !['tiny', 'medium', 'smart'].includes((unwrap(values.get('model')) as any)?.value) ||
        ['id', 'input', 'output', 'model', 'instructions', 'prompt'].some(
          (key) => !keys.has(key)
        ) ||
        ['limits', 'maxSteps', 'maxTokens'].some((key) => keys.has(key))
      );
    }

    function configuration(node: any) {
      const config = unwrap(node.arguments[0]);
      const properties = config?.type === 'ObjectExpression' ? config.properties : [];
      const values = new Map(
        properties
          .filter((p: any) => p.type === 'Property')
          .map((p: any) => [p.key.name ?? p.key.value, p.value])
      );

      return { properties, values };
    }

    function preparationStep(node: any): boolean {
      const step = unwrap(node);

      if (
        step?.type !== 'ObjectExpression' ||
        step.properties.some((property: any) => property.type === 'SpreadElement')
      )
        return false;

      const agent = unwrap(
        step.properties.find(
          (property: any) =>
            property.type === 'Property' && (property.key.name ?? property.key.value) === 'agent'
        )?.value
      );

      if (agent?.type === 'CallExpression') return target(agent.callee);

      const value = importedValue(context, agent);

      return !!value?.target && /^features\/.+\/agents\//.test(value.target);
    }

    function checkPreparation(node: any) {
      const { properties, values } = configuration(node);

      if (
        properties.some((p: any) => p.type === 'SpreadElement') ||
        !preparationStep(values.get('map')) ||
        !preparationStep(values.get('reduce'))
      )
        context.report({
          node,
          message: 'Context preparation must use canonical agent definitions.'
        });
    }

    return {
      ImportDeclaration: effects.imports,
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;

        if (declaration?.type === 'VariableDeclaration')
          for (const item of declaration.declarations) checkExport(item, item.init);

        if (!node.source && node.exportKind !== 'type')
          for (const specifier of node.specifiers)
            if (specifier.exportKind !== 'type') checkExport(specifier, specifier.local);
      },
      ExportDefaultDeclaration(node) {
        checkExport(node, node.declaration);
      },
      CallExpression(node) {
        if (preparation(node.callee)) return checkPreparation(node);

        if (!target(node.callee)) return;

        const { properties, values } = configuration(node);
        const keys = new Set(
          properties
            .filter((p: any) => p.type === 'Property')
            .map((p: any) => p.key.name ?? p.key.value)
        );

        if (invalidConfiguration(properties, values, keys))
          context.report({
            node,
            message:
              'Agent definitions must provide the canonical configuration; runtime owns limits.'
          });
      }
    };
  }
});
