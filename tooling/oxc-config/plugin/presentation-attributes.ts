import type { ESTree } from 'vite-plus/lint/plugins';

function isPresentationKey(key: string) {
  return key === 'className' || key === 'style';
}

export function isPresentationAttribute(node: ESTree.Node): boolean {
  if (node.type === 'JSXAttribute')
    return node.name.type === 'JSXIdentifier' && isPresentationKey(node.name.name);

  if (node.type !== 'JSXSpreadAttribute' || node.argument.type !== 'ObjectExpression') return false;

  return node.argument.properties.some((property) => {
    if (property.type !== 'Property') return false;

    if (property.key.type === 'Literal' && typeof property.key.value === 'string')
      return isPresentationKey(property.key.value);

    return (
      !property.computed &&
      property.key.type === 'Identifier' &&
      isPresentationKey(property.key.name)
    );
  });
}
