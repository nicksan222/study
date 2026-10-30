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

        const resolved = resolvedSource(filename, source);
        const retiredContract =
          /^@study\/contracts\/(?:procedures|jobs|material|practice|ingestion|study)(?:\/|$)/.test(
            source
          ) || retiredContractFile.test(resolved);

        const server = serverPath(filename);
        const resolvedServer = serverPath(resolved);
        const target = targetPath(filename, source);

        if (
          retiredContract ||
          retiredTransport(source) ||
          retiredServerImport(server, target, resolvedServer, retiredServerRoot)
        )
          context.report({
            node,
            message: 'Retired transport and server modules must be migrated.'
          });

        const path = resolvedSource(filename, source);

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

function resolvedSource(filename: string, source: string): string {
  return source.startsWith('.') || source.startsWith('/')
    ? resolve(dirname(filename), source).replaceAll('\\', '/')
    : '';
}

function retiredTransport(source: string): boolean {
  return /^@trpc(?:\/|$)/.test(source) || /^superjson(?:\/|$)/.test(source);
}

function retiredServerImport(
  server: string | null,
  target: string | null,
  resolved: string | null,
  pattern: RegExp
): boolean {
  return Boolean(
    (server && target && pattern.test(target)) || (resolved !== null && pattern.test(resolved))
  );
}
