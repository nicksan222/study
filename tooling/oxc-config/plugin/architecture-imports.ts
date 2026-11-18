import { BunPath } from '@effect/platform-bun';
import { Effect, Path } from 'effect';

import {
  binding,
  destructuredPath,
  constantDeclarator,
  runtimeImport,
  staticMember,
  enterNode
} from './lexical-bindings.ts';
import { requireBindings } from './require-bindings.ts';
import { serverExports, serverExportEdges, specifierName } from './server-exports.ts';

const { dirname, relative, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

export function serverPath(filename: string): string | null {
  const normalized = filename.replaceAll('\\', '/');
  const marker = '/apps/server/src/';
  const index = normalized.lastIndexOf(marker);

  return index < 0 ? null : normalized.slice(index + marker.length);
}

export function targetPath(filename: string, source: string, name?: string): string | null {
  if (source === '@study/server') return serverExports.get(name ?? '')?.target ?? 'platform/index';

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

  function edge(node: any, source: string | null, typeOnly: boolean) {
    check(node, source, typeOnly);

    if (source !== '@study/server' || !serverPath(context.filename)) return;

    for (const entry of serverExportEdges(node))
      check(
        node.specifiers?.length ? { ...node, specifiers: [entry.specifier] } : node,
        entry.target,
        typeOnly || entry.typeOnly
      );
  }

  return {
    TSImportType(node: any) {
      edge(node, literal(node.source), true);
    },
    ImportDeclaration(node: any) {
      edge(
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
        edge(
          node,
          node.source.value,
          node.exportKind === 'type' ||
            (node.specifiers.length > 0 &&
              node.specifiers.every((s: any) => s.exportKind === 'type'))
        );
    },
    ExportAllDeclaration(node: any) {
      edge(node, node.source.value, node.exportKind === 'type');
    },
    ImportExpression(node: any) {
      edge(node, literal(node.source), false);
    },
    TSImportEqualsDeclaration(node: any) {
      if (node.moduleReference?.type === 'TSExternalModuleReference')
        edge(node, literal(node.moduleReference.expression), node.importKind === 'type');
    },
    CallExpression(node: any) {
      if (!requireFunction(node.callee)) return;

      edge(node, literal(node.arguments[0]), false);
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
      ? exportedValue(base, [base.name, name].filter(Boolean).join('.'))
      : null;
  }

  return null;
}

export function canonicalImport(context: any, node: any, module: string, name: string): boolean {
  const value = importedValue(context, node);

  return value?.target === `platform/definitions/${module}` && value.name === name;
}

export function importTarget(context: any, specifier: any, name = specifierName(specifier)) {
  return targetPath(context.filename, specifier.parent.source.value, name);
}

function runtimeImportName(specifier: any): string {
  if (specifier.type === 'ImportNamespaceSpecifier') return '';

  if (specifier.type === 'ImportDefaultSpecifier') return 'default';

  return specifierName(specifier)!;
}

function directImport(context: any, def: any): ReturnType<typeof importedValue> {
  if (!runtimeImport(def)) return null;

  const name = runtimeImportName(def);
  const source = def.parent.source.value;
  const entry = source === '@study/server' && serverExports.get(name);

  return {
    source,
    target: importTarget(context, def, name),
    name: entry ? entry.name : name
  };
}

function exportedValue(base: NonNullable<ReturnType<typeof importedValue>>, name: string) {
  const [root, ...members] = name.split('.');
  const entry = base.source === '@study/server' && serverExports.get(root!);

  return entry
    ? { ...base, target: entry.target, name: [entry.name, ...members].join('.') }
    : { ...base, name };
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

    return names ? exportedValue(base, [base.name, ...names].filter(Boolean).join('.')) : null;
  }

  return null;
}
