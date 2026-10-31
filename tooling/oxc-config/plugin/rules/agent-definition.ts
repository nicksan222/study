import { defineRule } from 'vite-plus/lint/plugins';

import { featureRole, serverPath, targetPath } from '../architecture-imports.ts';
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
        (init.type !== 'CallExpression' || !target(init.callee))
      )
        context.report({ node, message: 'Agent exports must use defineAgent.' });
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
        if (!target(node.callee)) return;

        const config = unwrap(node.arguments[0]);
        const properties = config?.type === 'ObjectExpression' ? config.properties : [];
        const values = new Map(
          properties
            .filter((p: any) => p.type === 'Property')
            .map((p: any) => [p.key.name ?? p.key.value, p.value])
        );
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
