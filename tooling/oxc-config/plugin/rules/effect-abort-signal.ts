import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { enterNode, constantDeclarator, globalMember, binding } from '../lexical-bindings.ts';
import { businessFile, property, walk } from './effect-lifecycle-syntax.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename)) return {};

    const bindings = effectBindings(context);
    const fetchImports = new Set<any>();

    function nativeFetch(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen)) return false;

      if (node.type === 'Identifier') {
        const def = bindings.definition(node);

        if (!def) return node.name === 'fetch';

        if (fetchImports.has(def)) return true;

        return constantDeclarator(def) && nativeFetch(def.init, seen);
      }

      return globalMember(context, node, ['globalThis'], ['fetch']);
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
        const signalVariable = binding(context, signal);

        walk(callback.body, (child) => {
          if (child.type !== 'CallExpression' || !nativeFetch(child.callee)) return;

          const supplied = property(child.arguments[1], 'signal');

          if (!signalVariable || binding(context, supplied) !== signalVariable)
            context.report({
              node: child,
              message: 'Pass the Effect.tryPromise cancellation signal to fetch.'
            });
        });
      }
    };
  }
});
