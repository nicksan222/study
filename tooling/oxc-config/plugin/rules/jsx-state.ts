import type { ESTree } from 'vite-plus/lint/plugins';

export function children(node: ESTree.Node): ESTree.Node[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'parent') return [];

    const values = Array.isArray(value) ? value : [value];

    return values.filter(
      (item): item is ESTree.Node =>
        item !== null && typeof item === 'object' && typeof item.type === 'string'
    );
  });
}

export function stateComparison(
  node: Extract<ESTree.Node, { type: 'BinaryExpression' }>,
  truth: boolean,
  states: ReadonlySet<string>
): boolean {
  if (!['===', '==', '!==', '!='].includes(node.operator)) return false;

  const value = node.left.type === 'Literal' ? node.left : node.right;

  return (
    value.type === 'Literal' &&
    typeof value.value === 'string' &&
    states.has(value.value) &&
    truth === (node.operator === '===' || node.operator === '==')
  );
}
