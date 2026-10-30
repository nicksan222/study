import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';
import { nativeGlobal } from './native-global.ts';

const message =
  'Use Effect for feature orchestration; native async, Promise construction and fetch belong at I/O boundaries.';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');

    if (
      !serverProduction(path) ||
      !/\/apps\/server\/src\/features\/.*\/(?:[^/]+[.])?(?:service|store|workflow|agent|tool)\.ts$|\/apps\/server\/src\/features\/.*\/(?:service|store|workflow|agents?|tools?)\/[^/]+\.ts$|\/apps\/server\/src\/features\/sources\/fetch\.ts$/.test(
        path
      )
    )
      return {};

    const bindings = effectBindings(context);

    return {
      FunctionDeclaration(node) {
        if (node.async) context.report({ node, message });
      },
      FunctionExpression(node) {
        if (node.async) context.report({ node, message });
      },
      ArrowFunctionExpression(node) {
        if (node.async) context.report({ node, message });
      },
      CallExpression(node) {
        if (nativeGlobal(bindings, node.callee) === 'fetch') context.report({ node, message });
      },
      NewExpression(node) {
        if (nativeGlobal(bindings, node.callee) === 'Promise') context.report({ node, message });
      }
    };
  }
});
