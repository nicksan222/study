import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges, serverPath, targetPath } from '../architecture-imports.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const contracts = /\/packages\/contracts\/src\//.test(filename);
    const current = serverPath(filename);

    const browser = /\/(?:apps\/web|packages\/ui|packages\/theme)\/src\//.test(filename);

    if (
      !browser &&
      !contracts &&
      current !== 'index.ts' &&
      !current?.startsWith('client/') &&
      !current?.startsWith('shared/')
    )
      return {};

    return moduleEdges(context, (node, source) => {
      if (!source) {
        context.report({ node, message: 'Browser boundaries require literal module paths.' });

        return;
      }

      const db = /^@study\/db(?:\/|$)|^drizzle-orm(?:\/|$)/.test(source);
      const server = /^@study\/server(?:\/|$)/.test(source);
      const target = targetPath(filename, source);
      const privateServer =
        target !== null &&
        /^(?:domains|ai|runtime|procedures|features|platform)(?:\/|$)/.test(target);

      if (
        /^@trpc(?:\/|$)|^superjson(?:\/|$)/.test(source) ||
        rawServerClient(browser, server, source)
      ) {
        context.report({
          node,
          message:
            'Browser consumers must use contracts and the native RPC client; retired transport imports are forbidden.'
        });

        return;
      }

      const blocked = contracts
        ? db || server || contractSource(source)
        : browserSource(db, privateServer, server, source);

      if (blocked) {
        context.report({
          node,
          message: contracts
            ? 'Contracts cannot depend on server or database modules.'
            : 'Browser entrypoints cannot import server or database values.'
        });
      }
    });
  }
});

function contractSource(source: string): boolean {
  return (
    /\/apps\/server\//.test(source) ||
    /\/packages\/db\//.test(source) ||
    /^effect\/(?:unstable\/)?workflow(?:\/|$)/.test(source)
  );
}

function rawServerClient(browser: boolean, server: boolean, source: string): boolean {
  return browser && server && source !== '@study/server/client';
}

function browserSource(
  db: boolean,
  privateServer: boolean,
  server: boolean,
  source: string
): boolean {
  return db || privateServer || (server && !/^@study\/server(?:\/client)?$/.test(source));
}
