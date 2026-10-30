import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';
import { nativeGlobal } from './native-global.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current || current === 'app/router.ts') return {};

    const bindings = effectBindings(context);
    const report = (node: any) =>
      context.report({
        node,
        message:
          'Use TanStack Link, navigation and validated route search instead of browser URL manipulation.'
      });

    const globalPath = (node: any) => nativeGlobal(bindings, node);

    return {
      MemberExpression(node) {
        const path = globalPath(node)?.replace(/^(?:window|globalThis)\./, '');

        if (!path) return;

        if (/^history\.(?:pushState|replaceState|back|forward|go)$/.test(path)) report(node);

        if (
          /^location\.[^.]+$/.test(path) &&
          !(path === 'location.origin' && current === 'lib/study-client/client.ts') &&
          !(
            node.parent?.type === 'NewExpression' &&
            globalPath(node.parent.callee) === 'URLSearchParams'
          )
        )
          report(node);
      },
      AssignmentExpression(node) {
        const path = globalPath(node.left)?.replace(/^(?:window|globalThis)\./, '');

        if (path === 'location') report(node);
      },
      NewExpression(node) {
        if (globalPath(node.callee) === 'URLSearchParams') report(node);
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'a') return;

        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.name !== 'href') continue;

          const value =
            attribute.value?.type === 'Literal'
              ? attribute.value.value
              : attribute.value?.type === 'JSXExpressionContainer' &&
                  attribute.value.expression.type === 'Literal'
                ? attribute.value.expression.value
                : null;

          if (typeof value === 'string' && /^(?:\/(?!\/)|#\/)/.test(value)) report(attribute);
        }
      }
    };
  }
});
