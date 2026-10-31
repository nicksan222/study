import { dirname, relative, resolve } from 'node:path';

import {
  binding,
  constantDeclarator,
  runtimeImport,
  staticMember,
  namedProperty,
  enterNode
} from './lexical-bindings.ts';
import { requireBindings } from './require-bindings.ts';

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

  const requireFunction = requireBindings(context);

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

/** Resolve runtime imports through lexical const aliases without trusting identifier spelling. */
export function importedValue(
  context: any,
  node: any,
  seen = new Set<any>()
): { source: string; target: string | null; name: string } | null {
  if (!enterNode(node, seen)) return null;

  if (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'ParenthesizedExpression'
    ].includes(node.type)
  )
    return importedValue(context, node.expression, seen);

  if (node.type === 'Identifier') {
    const def = binding(context, node)?.defs[0]?.node;

    const direct = directImport(context, def);

    if (direct) return direct;

    return aliasedImport(context, node, def, seen);
  }

  if (staticMember(node)) {
    const base = importedValue(context, node.object, seen);
    const name = node.property.name ?? node.property.value;

    return base && typeof name === 'string'
      ? { ...base, name: [base.name, name].filter(Boolean).join('.') }
      : null;
  }

  return null;
}

export function canonicalImport(context: any, node: any, module: string, name: string): boolean {
  const value = importedValue(context, node);

  return value?.target === `platform/definitions/${module}` && value.name === name;
}

function directImport(context: any, def: any): ReturnType<typeof importedValue> {
  if (runtimeImport(def)) {
    const name =
      def.type === 'ImportSpecifier'
        ? (def.imported.name ?? def.imported.value)
        : def.type === 'ImportNamespaceSpecifier'
          ? ''
          : def.type === 'ImportDefaultSpecifier'
            ? 'default'
            : null;

    return name === null
      ? null
      : {
          source: def.parent.source.value,
          target: targetPath(context.filename, def.parent.source.value),
          name
        };
  }

  return null;
}

function aliasedImport(
  context: any,
  node: any,
  def: any,
  seen: Set<any>
): ReturnType<typeof importedValue> {
  if (constantDeclarator(def)) {
    const base = importedValue(context, def.init, seen);

    if (!base || def.id.type === 'Identifier') return base;

    const names = destructuredPath(def.id, node.name, []);

    return names ? { ...base, name: [base.name, ...names].filter(Boolean).join('.') } : null;
  }

  return null;
}

function destructuredPath(pattern: any, target: string, names: string[]): string[] | null {
  if (pattern.type === 'Identifier') return pattern.name === target ? names : null;

  if (pattern.type !== 'ObjectPattern') return null;

  for (const part of pattern.properties) {
    if (!namedProperty(part)) continue;

    const found = destructuredPath(part.value, target, [...names, part.key.name ?? part.key.value]);

    if (found) return found;
  }

  return null;
}
