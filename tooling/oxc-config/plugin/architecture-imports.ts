import { dirname, relative, resolve } from 'node:path';

import { binding, imported, property } from './rules/synchronous-transactions.ts';

export function serverPath(filename: string): string | null {
  const normalized = filename.replaceAll('\\', '/');
  const marker = '/apps/server/src/';
  const index = normalized.lastIndexOf(marker);

  return index < 0 ? null : normalized.slice(index + marker.length);
}

export function targetPath(filename: string, source: string): string | null {
  const normalized = filename.replaceAll('\\', '/');
  const marker = '/apps/server/src/';
  const index = normalized.lastIndexOf(marker);

  if (index < 0) return null;

  const root = normalized.slice(0, index + marker.length);
  const target = source.startsWith('#server/')
    ? resolve(root, source.slice(8))
    : source.startsWith('.') || source.startsWith('/')
      ? resolve(dirname(filename), source)
      : null;

  return target === null
    ? null
    : relative(root, target)
        .replaceAll('\\', '/')
        .replace(/\.[cm]?[jt]sx?$/, '');
}

export function moduleEdges(
  context: any,
  check: (node: any, source: string | null, typeOnly: boolean) => void
) {
  function literal(node: any): string | null {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;

    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
      return node.quasis[0]?.value.cooked ?? null;

    return null;
  }

  function createRequire(node: any, seen = new Set<any>()): boolean {
    if (!node || seen.has(node)) return false;

    seen.add(node);

    if (imported(context, node, /^(?:node:)?module$/, 'createRequire')) return true;

    if (property(node) === 'createRequire' && imported(context, node.object, /^(?:node:)?module$/))
      return true;

    const definition = binding(context, node)?.defs[0]?.node;

    return (
      definition?.type === 'VariableDeclarator' &&
      definition.parent?.kind === 'const' &&
      createRequire(definition.init, seen)
    );
  }

  function requireFunction(node: any, seen = new Set<any>()): boolean {
    if (!node || seen.has(node)) return false;

    seen.add(node);

    if (
      node.type === 'Identifier' &&
      node.name === 'require' &&
      !binding(context, node)?.defs.length
    )
      return true;

    if (
      property(node) === 'require' &&
      node.object.type === 'Identifier' &&
      ['module', 'globalThis', 'global'].includes(node.object.name) &&
      !binding(context, node.object)?.defs.length
    )
      return true;

    if (node.type === 'CallExpression' && createRequire(node.callee)) return true;

    const definition = binding(context, node)?.defs[0]?.node;

    return (
      definition?.type === 'VariableDeclarator' &&
      definition.parent?.kind === 'const' &&
      requireFunction(definition.init, seen)
    );
  }

  return {
    TSImportType(node: any) {
      check(node, literal(node.source), true);
    },
    ImportDeclaration(node: any) {
      check(
        node,
        node.source.value,
        node.importKind === 'type' ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(
              (s: any) => s.type === 'ImportSpecifier' && s.importKind === 'type'
            ))
      );
    },
    ExportNamedDeclaration(node: any) {
      if (node.source)
        check(
          node,
          node.source.value,
          node.exportKind === 'type' ||
            (node.specifiers.length > 0 &&
              node.specifiers.every((s: any) => s.exportKind === 'type'))
        );
    },
    ExportAllDeclaration(node: any) {
      check(node, node.source.value, node.exportKind === 'type');
    },
    ImportExpression(node: any) {
      check(node, literal(node.source), false);
    },
    TSImportEqualsDeclaration(node: any) {
      if (node.moduleReference?.type === 'TSExternalModuleReference')
        check(node, literal(node.moduleReference.expression), node.importKind === 'type');
    },
    CallExpression(node: any) {
      if (!requireFunction(node.callee)) return;

      check(node, literal(node.arguments[0]), false);
    }
  };
}

/** Classify a feature module by its first, canonical role directory. */
export function featureRole(path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/');
  const relative = /(?:^|\/)features\/[^/]+\/(.*)$/.exec(normalized)?.[1] ?? normalized;
  const folder = relative.split('/')[0];
  const roles: Record<string, string> = {
    service: 'service',
    store: 'store',
    rpc: 'rpc',
    workflows: 'workflow',
    agents: 'agent',
    tools: 'tool',
    decoders: 'decoder',
    codecs: 'codec'
  };

  if (roles[folder ?? '']) return roles[folder!];

  const name =
    relative
      .split('/')
      .at(-1)
      ?.replace(/\.[cm]?[jt]sx?$/, '') ?? '';

  return /(?:^|\.)(service|store|rpc|workflow|agent|tool|decoder)$/.exec(name)?.[1];
}
