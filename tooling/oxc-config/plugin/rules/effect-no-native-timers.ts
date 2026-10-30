import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
import { businessFile } from './effect-lifecycle-syntax.ts';
import { nativeGlobal } from './native-global.ts';

const message =
  'Use Effect.sleep or a scoped Effect schedule instead of native timers in application operations.';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (
      !businessFile(context.filename) ||
      /\/runtime\/(?:main|server|service)\.ts$/.test(context.filename)
    )
      return {};

    const bindings = effectBindings(context);

    function timer(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'Identifier') {
        const def = bindings.definition(node);

        return !def
          ? ['setTimeout', 'setInterval'].includes(node.name)
          : def.type === 'VariableDeclarator' &&
              def.parent?.kind === 'const' &&
              timer(def.init, seen);
      }

      return (
        node.type === 'MemberExpression' &&
        (!node.computed || node.property.type === 'Literal') &&
        node.object.type === 'Identifier' &&
        ['globalThis', 'global'].includes(node.object.name) &&
        !bindings.definition(node.object) &&
        ['setTimeout', 'setInterval'].includes(propertyName(node.property) ?? '')
      );
    }

    return {
      ImportDeclaration(node) {
        if (
          /^(?:node:)?timers(?:\/promises)?$/.test(node.source.value) &&
          node.importKind !== 'type'
        )
          context.report({ node, message });
      },
      CallExpression(node) {
        if (timer(node.callee) || nativeGlobal(bindings, node.callee) === 'AbortSignal.timeout')
          context.report({ node, message });
      }
    };
  }
});
