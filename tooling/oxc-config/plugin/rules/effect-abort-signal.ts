import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { businessFile, property, walk } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename)) return {};

    const bindings = effectBindings(context);
    const fetchImports = new Set<any>();

    function nativeFetch(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'Identifier') {
        const def = bindings.definition(node);

        if (!def) return node.name === 'fetch';

        if (fetchImports.has(def)) return true;

        return (
          def.type === 'VariableDeclarator' &&
          def.parent?.kind === 'const' &&
          nativeFetch(def.init, seen)
        );
      }

      return (
        node.type === 'MemberExpression' &&
        (!node.computed || node.property.type === 'Literal') &&
        node.object.type === 'Identifier' &&
        node.object.name === 'globalThis' &&
        !bindings.definition(node.object) &&
        propertyName(node.property) === 'fetch'
      );
    }

    function variable(node: any): any {
      if (node?.type !== 'Identifier') return null;

      let scope = context.sourceCode.getScope(node);

      while (scope) {
        const found = scope.set.get(node.name);

        if (found) return found;

        scope = scope.upper!;
      }

      return null;
    }

    return {
      ImportDeclaration(node) {
        bindings.imports(node);

        if (node.importKind === 'type' || !['undici', 'node-fetch'].includes(node.source.value))
          return;

        for (const specifier of node.specifiers) {
          if (
            (specifier.type === 'ImportSpecifier' &&
              specifier.importKind !== 'type' &&
              propertyName(specifier.imported) === 'fetch') ||
            (specifier.type === 'ImportDefaultSpecifier' && node.source.value === 'node-fetch')
          )
            fetchImports.add(specifier);
        }
      },
      CallExpression(node) {
        if (bindings.resolve(node.callee) !== 'Effect.tryPromise') return;

        const options = node.arguments[0];
        const callback = property(options, 'try') ?? options;

        if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression')
          return;

        const signal = callback.params[0];
        const signalVariable = variable(signal);

        walk(callback.body, (child) => {
          if (child.type !== 'CallExpression' || !nativeFetch(child.callee)) return;

          const supplied = property(child.arguments[1], 'signal');

          if (!signalVariable || variable(supplied) !== signalVariable)
            context.report({
              node: child,
              message: 'Pass the Effect.tryPromise cancellation signal to fetch.'
            });
        });
      }
    };
  }
});
