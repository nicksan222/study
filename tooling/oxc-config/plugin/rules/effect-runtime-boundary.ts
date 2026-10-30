import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Run Effects and construct ManagedRuntime only at approved server runtime boundaries.';

    const path = context.filename.replaceAll('\\', '/');
    const execute = /\/apps\/server\/src\/(?:runtime\/main|platform\/ai\/tool-adapter)\.ts$/.test(
      path
    );
    const syncObservation = path.endsWith('/apps/server/src/platform/observability/index.ts');
    const construct = /\/apps\/server\/src\/runtime\/(?:main|layers)\.ts$/.test(path);

    function httpPromiseBridge(node: any, name: string): boolean {
      if (!path.endsWith('/apps/server/src/platform/http/index.ts') || name !== 'Effect.runPromise')
        return false;

      for (let owner = node.parent; owner; owner = owner.parent) {
        if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(owner.type))
          return (
            owner.type === 'FunctionDeclaration' &&
            owner.id?.name === 'runHttpPromise' &&
            owner.parent?.type === 'ExportNamedDeclaration'
          );
      }

      return false;
    }

    return {
      ImportDeclaration: bindings.imports,
      CallExpression(node) {
        const name = bindings.resolve(node.callee);

        if (
          name &&
          ((/^Effect\.run(?:Promise|PromiseExit|Sync|SyncExit|Fork|Callback)(?:With)?$/.test(
            name
          ) &&
            !execute &&
            !httpPromiseBridge(node, name) &&
            !(syncObservation && name === 'Effect.runSyncWith')) ||
            (name === 'ManagedRuntime.make' && !construct))
        )
          context.report({ node, message });
      }
    };
  }
});
