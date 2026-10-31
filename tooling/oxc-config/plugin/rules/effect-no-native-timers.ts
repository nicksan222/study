import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { imported, enterNode, constantDeclarator, globalMember } from '../lexical-bindings.ts';
import { webFile } from '../web-files.ts';
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
      if (!enterNode(node, seen)) return false;

      if (node.type === 'Identifier') {
        const def = bindings.definition(node);

        return !def
          ? ['setTimeout', 'setInterval'].includes(node.name)
          : constantDeclarator(def) && timer(def.init, seen);
      }

      return globalMember(context, node, ['globalThis', 'global'], ['setTimeout', 'setInterval']);
    }

    function uiDebounce(node: any): boolean {
      const current = webFile(context.filename);

      if (
        !current ||
        !/(?:^|\/)use-[^/]+\.tsx?$/.test(current) ||
        nativeGlobal(bindings, node.callee) !== 'setTimeout'
      )
        return false;

      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          parent.type === 'CallExpression' &&
          imported(context, parent.callee, /^react$/, 'useEffect')
        )
          return true;
      }

      return false;
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
        if (
          (timer(node.callee) && !uiDebounce(node)) ||
          nativeGlobal(bindings, node.callee) === 'AbortSignal.timeout'
        )
          context.report({ node, message });
      }
    };
  }
});
