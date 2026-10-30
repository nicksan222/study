import type { ESTree } from 'vite-plus/lint/plugins';

import { webFile } from '../web-files.ts';

export function businessFile(filename: string): boolean {
  const path = filename.replaceAll('\\', '/');

  return (
    Boolean(webFile(filename)) ||
    (path.includes('/apps/server/src/') &&
      !/\/(?:client|test|tests)\/|\.(?:test|spec)\.ts$/.test(path))
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
      walkChildren(value, visit);
    } else if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      typeof value.type === 'string'
    )
      walk(value as ESTree.Node, visit);
  }
}

function walkChildren(children: any[], visit: (node: ESTree.Node) => void): void {
  for (const item of children)
    if (item && typeof item === 'object' && typeof item.type === 'string') walk(item, visit);
}
