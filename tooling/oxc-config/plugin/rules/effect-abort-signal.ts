import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { enterNode, constantDeclarator, globalMember, binding } from '../lexical-bindings.ts';
import { businessFile, property, walk } from './effect-lifecycle-syntax.ts';
import { callbackTarget } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!businessFile(context.filename)) return {};

    const bindings = effectBindings(context);
    const fetchImports = new Set<any>();
    const bridges = new Map<any, { api: string; signal: any }>();

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

    function owner(node: any): any {
      for (let parent = node.parent; parent; parent = parent.parent)
        if (bridges.has(parent)) return parent;

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
        const api = bindings.resolve(node.callee);

        if (api !== 'Effect.tryPromise' && api !== 'Effect.callback') return;

        const options = node.arguments[0];
        const callback = callbackTarget(
          context,
          api === 'Effect.tryPromise' ? (property(options, 'try') ?? options) : options
        );

        if (!callback) return;

        const signal = callback.params[api === 'Effect.callback' ? 1 : 0];

        bridges.set(callback, { api, signal: binding(context, signal) });
      },
      'Program:exit'() {
        for (const [callback, bridge] of bridges)
          walk(callback.body, (child) => {
            if (
              child.type !== 'CallExpression' ||
              !nativeFetch(child.callee) ||
              owner(child) !== callback
            )
              return;

            const supplied = property(child.arguments[1], 'signal');

            if (!bridge.signal || binding(context, supplied) !== bridge.signal)
              context.report({
                node: child,
                message: `Pass the ${bridge.api} cancellation signal to fetch.`
              });
          });
      }
    };
  }
});
