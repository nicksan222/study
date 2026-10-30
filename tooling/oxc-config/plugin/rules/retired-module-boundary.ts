import { resolve, dirname } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges, serverPath, targetPath } from '../architecture-imports.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const retiredServerRoot =
      /^(?:(?:domains|procedures|application|ai|workflows)(?:\/|$)|runtime\/(?:request|router|trpc|procedure-context|grounding|errors)(?:\.[cm]?[jt]sx?)?$)/;
    const retiredContractFile =
      /\/packages\/contracts\/src\/(?:procedures|jobs|material|practice|ingestion|study)(?:\/|$)/;
    const current = serverPath(filename);
    const retiredFile =
      /\/packages\/ai\/src\//.test(filename) ||
      retiredContractFile.test(filename) ||
      (current !== null && retiredServerRoot.test(current));

    return {
      ...moduleEdges(context, (node, source) => {
        if (!source) return;

        const resolved =
          source.startsWith('.') || source.startsWith('/')
            ? resolve(dirname(filename), source).replaceAll('\\', '/')
            : '';
        const retiredContract =
          /^@study\/contracts\/(?:procedures|jobs|material|practice|ingestion|study)(?:\/|$)/.test(
            source
          ) || retiredContractFile.test(resolved);

        const server = serverPath(filename);
        const resolvedServer = serverPath(resolved);
        const target = targetPath(filename, source);

        if (
          retiredContract ||
          /^@trpc(?:\/|$)/.test(source) ||
          /^superjson(?:\/|$)/.test(source) ||
          (server && target && retiredServerRoot.test(target)) ||
          (resolvedServer !== null && retiredServerRoot.test(resolvedServer))
        )
          context.report({
            node,
            message: 'Retired transport and server modules must be migrated.'
          });

        const path =
          source.startsWith('.') || source.startsWith('/')
            ? resolve(dirname(filename), source).replaceAll('\\', '/')
            : '';

        if (/^@study\/ai(?:\/|$)/.test(source) || /\/packages\/ai(?:\/|$)/.test(path))
          context.report({
            node,
            message:
              'Use canonical server features and platform modules instead of retired implementations.'
          });
      }),
      Program(node) {
        if (retiredFile)
          context.report({
            node,
            message:
              'Use canonical server features and platform modules instead of retired implementations.'
          });
      }
    };
  }
});
