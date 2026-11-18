import type { effectBindings } from '../effect-bindings.ts';
import { propertyName } from '../effect-bindings.ts';
import {
  destructuredPath,
  staticMember,
  enterNode,
  transparentExpression
} from '../lexical-bindings.ts';

export function nativeGlobal(
  bindings: ReturnType<typeof effectBindings>,
  node: any,
  seen = new Set<any>()
): string | null {
  if (!enterNode(node, seen)) return null;

  const expression = transparentExpression(node);

  if (expression) return nativeGlobal(bindings, expression, seen);

  if (node.type === 'Identifier') {
    const def = bindings.definition(node);

    if (!def) return node.name;

    const imported = importedGlobal(def);

    if (imported) return imported;

    return aliasedGlobal(bindings, node, def, seen);
  }

  if (node.type === 'LogicalExpression' && ['??', '||'].includes(node.operator)) {
    const right = nativeGlobal(bindings, node.right, seen);

    if (right === 'fetch') return right;
  }

  return memberGlobal(bindings, node, seen);
}

function memberGlobal(
  bindings: ReturnType<typeof effectBindings>,
  node: any,
  seen: Set<any>
): string | null {
  if (staticMember(node)) {
    const base = nativeGlobal(bindings, node.object, seen);
    const name = propertyName(node.property);

    return name ? nativePath(base, [name]) : null;
  }

  return null;
}

function importedGlobal(def: any): string | null {
  if (
    def.type === 'ImportSpecifier' &&
    /^(?:node:)?perf_hooks$/.test(def.parent.source.value) &&
    propertyName(def.imported) === 'performance'
  )
    return 'performance';

  if (
    (def.type === 'ImportNamespaceSpecifier' || def.type === 'ImportDefaultSpecifier') &&
    /^(?:node:)?process$/.test(def.parent.source.value)
  )
    return 'process';

  if (
    def.type === 'ImportSpecifier' &&
    /^(?:node:)?process$/.test(def.parent.source.value) &&
    propertyName(def.imported) === 'hrtime'
  )
    return 'process.hrtime';

  return null;
}

function aliasedGlobal(
  bindings: ReturnType<typeof effectBindings>,
  node: any,
  def: any,
  seen: Set<any>
): string | null {
  if (def.type !== 'VariableDeclarator' || def.parent?.kind !== 'const') return null;

  if (def.id.type === 'Identifier') return nativeGlobal(bindings, def.init, seen);

  if (def.id.type !== 'ObjectPattern') return null;

  const base = nativeGlobal(bindings, def.init, seen);
  const names = destructuredPath(def.id, node.name, []);

  return nativePath(base, names);
}

function nativePath(base: string | null, names: readonly string[] | null | undefined) {
  if (!base || !names?.length || names.some((part) => part.includes('.'))) return null;

  const name = names.join('.');

  return ['globalThis', 'global'].includes(base) ? name : `${base}.${name}`;
}
