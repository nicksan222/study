import { defineRule } from 'vite-plus/lint/plugins';

import { targetPath } from '../architecture-imports.ts';
import { binding, production, property } from './synchronous-transactions.ts';

export function entry(
  filename: string
): { domain: string; owner: 'service' | 'store'; index: boolean } | null {
  const path = filename.replaceAll('\\', '/');

  if (!production(path)) return null;

  const match =
    /\/apps\/server\/src\/features\/([^/]+)\/(index\.ts|(?:service|store)\/index\.ts)$/.exec(path);

  if (!match) {
    const legacy =
      /\/apps\/server\/src\/features\/([^/]+)\/((?:[^/]+\/)*(?:[^/]+\.)?(service|store)\.ts)$/.exec(
        path
      );

    return legacy
      ? { domain: legacy[1], owner: legacy[3] as 'service' | 'store', index: false }
      : null;
  }

  return {
    domain: match[1],
    owner: match[2] === 'store/index.ts' ? 'store' : 'service',
    index: match[2] === 'index.ts'
  };
}

export function resolveValue(context: any, node: any, seen = new Set<any>()): any {
  if (!node || seen.has(node)) return null;

  seen.add(node);

  if (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'ParenthesizedExpression'
    ].includes(node.type)
  )
    return resolveValue(context, node.expression, seen);

  if (node.type === 'Identifier') {
    const def = binding(context, node)?.defs[0]?.node;

    if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const')
      return resolveValue(context, def.init, seen);
  }

  return node;
}

export function isFactory(
  context: any,
  node: any,
  owner: 'service' | 'store',
  seen = new Set<any>()
): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);

  if (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'ParenthesizedExpression'
    ].includes(node.type)
  )
    return isFactory(context, node.expression, owner, seen);

  const expected = owner === 'service' ? 'defineService' : 'defineStore';

  if (node.type === 'Identifier') {
    const def = binding(context, node)?.defs[0]?.node;

    if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const')
      return isFactory(context, def.init, owner, seen);

    return (
      def?.type === 'ImportSpecifier' &&
      (def.imported.name ?? def.imported.value) === expected &&
      def.importKind !== 'type' &&
      def.parent.importKind !== 'type' &&
      targetPath(context.filename, def.parent.source.value) ===
        `platform/definitions/define-${owner}`
    );
  }

  if (property(node) === expected && node.object?.type === 'Identifier') {
    const object = resolveValue(context, node.object);
    const def = binding(context, object)?.defs[0]?.node;

    return (
      def?.type === 'ImportNamespaceSpecifier' &&
      def.parent.importKind !== 'type' &&
      targetPath(context.filename, def.parent.source.value) ===
        `platform/definitions/define-${owner}`
    );
  }

  return false;
}

export function factoryCall(context: any, node: any, owner: 'service' | 'store'): any {
  const value = resolveValue(context, node);

  return value?.type === 'CallExpression' && isFactory(context, value.callee, owner) ? value : null;
}

export function entryReexport(context: any, node: any, domain: string): boolean {
  const target = targetPath(context.filename, node.source?.value);

  return (
    target === `features/${domain}/service/index` ||
    target === `features/${domain}/${domain}.service` ||
    target === `features/${domain}/service`
  );
}

/** Keep public domain entry exports on the canonical construction boundary. */
export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const info = entry(context.filename);

    if (!info) return {};

    const { owner, domain, index } = info;
    const expected = owner === 'service' ? 'defineService' : 'defineStore';
    let runtimeExport = false;

    function check(node: any, value: any) {
      runtimeExport = true;

      if (factoryCall(context, value, owner)) return;

      const resolved = resolveValue(context, value);

      if (
        owner === 'service' &&
        property(resolved) === 'layer' &&
        factoryCall(context, resolved.object, 'service')
      )
        return;

      context.report({ node, message: `Exported feature ${owner} modules must use ${expected}.` });
    }

    return {
      ExportNamedDeclaration(node: any) {
        if (node.exportKind === 'type') return;

        if (node.source) {
          if (
            node.specifiers.length > 0 &&
            node.specifiers.every((specifier: any) => specifier.exportKind === 'type')
          )
            return;

          if (node.specifiers.some((specifier: any) => specifier.exportKind !== 'type'))
            runtimeExport = true;

          if (!index || !entryReexport(context, node, domain))
            context.report({
              node,
              message: `Feature ${owner} exports must be defined by ${expected}.`
            });

          return;
        }

        if (node.declaration?.type === 'VariableDeclaration')
          for (const item of node.declaration.declarations) check(item, item.init);
        else if (['ClassDeclaration', 'FunctionDeclaration'].includes(node.declaration?.type))
          check(node.declaration, node.declaration);

        for (const specifier of node.specifiers)
          if (specifier.exportKind !== 'type') check(specifier, specifier.local);
      },
      ExportAllDeclaration(node: any) {
        if (node.exportKind !== 'type') runtimeExport = true;

        if (node.exportKind !== 'type' && (!index || !entryReexport(context, node, domain)))
          context.report({
            node,
            message: `Feature ${owner} exports must be defined by ${expected}.`
          });
      },
      ExportDefaultDeclaration(node: any) {
        check(node, node.declaration);
      },
      'Program:exit'(node: any) {
        if (owner === 'store' && !runtimeExport)
          context.report({ node, message: 'Export a feature store using defineStore.' });
      }
    };
  }
});
