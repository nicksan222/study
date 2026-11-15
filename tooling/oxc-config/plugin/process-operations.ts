import { binding, imported, memberName } from './lexical-bindings.ts';
import { resolveValue } from './rules/module-factories.ts';

export function bunOperation(context: any, callee: any): string | undefined {
  for (const name of ['spawn', 'spawnSync', 'sleep', '$'])
    if (imported(context, resolveValue(context, callee), /^bun$/, name)) return name;

  const value = resolveValue(context, callee);

  if (value?.type !== 'MemberExpression') return;

  const owner = resolveValue(context, value.object);

  if (
    (owner?.type === 'Identifier' &&
      owner.name === 'Bun' &&
      !binding(context, owner)?.defs.length) ||
    namespaceImport(context, owner, /^bun$/)
  )
    return memberName(value);
}

export function namespaceImport(context: any, node: any, source: RegExp): boolean {
  return (
    binding(context, node)?.defs.some(
      (definition: any) =>
        definition.node.type === 'ImportNamespaceSpecifier' &&
        source.test(definition.node.parent.source.value)
    ) ?? false
  );
}
