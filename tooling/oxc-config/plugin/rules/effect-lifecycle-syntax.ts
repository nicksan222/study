import type { ESTree } from 'vite-plus/lint/plugins';

export function businessFile(filename: string): boolean {
  const path = filename.replaceAll('\\', '/');

  return (
    path.includes('/apps/server/src/') &&
    !/\/(?:client|test|tests)\/|\.(?:test|spec)\.ts$/.test(path)
  );
}

export function property(node: any, name: string): any {
  if (node?.type !== 'ObjectExpression') return undefined;

  for (let index = node.properties.length - 1; index >= 0; index--) {
    const item = node.properties[index];

    if (item.type === 'SpreadElement' || (item.computed && item.key.type !== 'Literal'))
      return undefined;

    if (
      item.type === 'Property' &&
      ((!item.computed && item.key.type === 'Identifier' && item.key.name === name) ||
        (item.key.type === 'Literal' && item.key.value === name))
    )
      return item.value;
  }

  return undefined;
}

export function positive(node: any, zero = false): boolean {
  return (
    node?.type === 'Literal' &&
    typeof node.value === 'number' &&
    Number.isFinite(node.value) &&
    Number.isInteger(node.value) &&
    (zero ? node.value >= 0 : node.value > 0)
  );
}

export function walk(node: ESTree.Node, visit: (node: ESTree.Node) => void): void {
  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;

    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === 'object' && typeof item.type === 'string') walk(item, visit);
    } else if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      typeof value.type === 'string'
    )
      walk(value as ESTree.Node, visit);
  }
}
