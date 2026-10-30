import { constantDeclarator, namedProperty, lexicalResolver } from './lexical-bindings.ts';
import { webFile } from './web-files.ts';

export function serverProduction(filename: string): boolean {
  const path = filename.replaceAll('\\', '/');

  return (
    /\/apps\/server\//.test(path) && !/\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests)\//.test(path)
  );
}

export function effectProduction(filename: string): boolean {
  return serverProduction(filename) || Boolean(webFile(filename));
}

export function propertyName(node: any): string | null {
  return node?.type === 'Identifier'
    ? node.name
    : node?.type === 'Literal' && typeof node.value === 'string'
      ? node.value
      : null;
}

export function effectBindings(context: any) {
  const imported = new Map<any, string>();

  function imports(node: any): void {
    if (node.importKind === 'type') return;

    const source = node.source.value;

    if (source !== 'effect' && !source.startsWith('effect/')) return;

    for (const specifier of node.specifiers) {
      if (specifier.importKind === 'type') continue;

      if (specifier.type === 'ImportNamespaceSpecifier')
        imported.set(specifier, source === 'effect' ? 'root' : source.slice(7));
      else if (specifier.type === 'ImportSpecifier') {
        const name = propertyName(specifier.imported);

        imported.set(specifier, source === 'effect' ? name! : `${source.slice(7)}.${name}`);
      }
    }
  }

  function definition(node: any): any {
    let scope = context.sourceCode.getScope(node);

    while (scope) {
      const variable = scope.set.get(node.name);

      if (variable) return variable.defs[0]?.node;

      scope = scope.upper;
    }

    return null;
  }

  function destructured(pattern: any, local: string, base: string): string | null {
    if (pattern.type === 'Identifier') return pattern.name === local ? base : null;

    if (pattern.type !== 'ObjectPattern') return null;

    for (const property of pattern.properties) {
      if (!namedProperty(property)) continue;

      const name = propertyName(property.key);

      if (!name) continue;

      const result = destructured(
        property.value,
        local,
        base === 'root' ? name : `${base}.${name}`
      );

      if (result) return result;
    }

    return null;
  }

  const resolve = lexicalResolver(resolveIdentifier, resolveMember);

  function resolveMember(node: any, seen: Set<any>): string | null {
    const object = resolve(node.object, seen);
    const name =
      !node.computed || node.property.type === 'Literal' ? propertyName(node.property) : null;

    if (object && name) return object === 'root' ? name : `${object}.${name}`;

    return null;
  }

  function resolveIdentifier(node: any, seen: Set<any>): string | null {
    const def = definition(node);

    if (imported.has(def)) return imported.get(def)!;

    if (constantDeclarator(def) && def.id.type === 'Identifier') return resolve(def.init, seen);

    if (constantDeclarator(def) && def.id.type === 'ObjectPattern') {
      const base = resolve(def.init, seen);

      return base ? destructured(def.id, node.name, base) : null;
    }

    return null;
  }

  return { imports, resolve, definition };
}
