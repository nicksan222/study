import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!effectProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Run Effects and construct ManagedRuntime only at approved application runtime boundaries.';

    const path = context.filename.replaceAll('\\', '/');
    const webRuntime = path.endsWith('/apps/client/src/lib/effect/runtime.ts');
    const execute =
      webRuntime ||
      /\/apps\/server\/src\/(?:runtime\/main|platform\/ai\/tool-adapter)\.ts$/.test(path);
    const syncObservation = path.endsWith('/apps/server/src/platform/observability/index.ts');
    const construct = webRuntime || /\/apps\/server\/src\/runtime\/(?:main|layers)\.ts$/.test(path);

    function approvedBridge(node: any, name: string): boolean {
      const bridges = [
        {
          suffix: '/apps/server/src/platform/http/index.ts',
          runner: 'Effect.runPromise',
          name: 'runHttpPromise',
          exported: true
        },
        {
          suffix: '/apps/server/src/platform/filesystem/index.ts',
          runner: 'Effect.runPromise',
          name: 'runFileSystemPromise',
          exported: true
        },
        {
          suffix: '/apps/server/src/platform/filesystem/index.ts',
          runner: 'Effect.runSync',
          name: 'runFileSystemSync',
          exported: false
        }
      ];
      const bridge = bridges.find((entry) => path.endsWith(entry.suffix) && name === entry.runner);

      if (!bridge) return false;

      for (let owner = node.parent; owner; owner = owner.parent) {
        if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(owner.type))
          return (
            owner.type === 'FunctionDeclaration' &&
            owner.id?.name === bridge.name &&
            owner.parent?.type === (bridge.exported ? 'ExportNamedDeclaration' : 'Program')
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
            !approvedBridge(node, name) &&
            !(syncObservation && name === 'Effect.runSyncWith')) ||
            (name === 'ManagedRuntime.make' && !construct))
        )
          context.report({ node, message });
      }
    };
  }
});
