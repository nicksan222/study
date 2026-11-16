/** Resolve the explicit server facade without loading its runtime capabilities into lint. */
const source = await Bun.file(
  new URL('../../../apps/server/src/platform/index.ts', import.meta.url)
).text();

export const serverExports = new Map<string, { target: string; name: string }>();

for (const declaration of source.matchAll(
  /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'\.\/([^']+)';/g
)) {
  const target = `platform/${declaration[2]!.replace(/\.ts$/, '')}`;

  for (const specifier of declaration[1]!.split(',')) {
    const [name, alias = name] = specifier.trim().split(/\s+as\s+/);

    if (name) serverExports.set(alias!, { target, name });
  }
}

export function specifierName(specifier: any): string | undefined {
  return (
    specifier.imported?.name ??
    specifier.imported?.value ??
    specifier.local?.name ??
    specifier.local?.value
  );
}

function specifierExports(specifier: any) {
  if (specifier.type === 'ImportNamespaceSpecifier')
    return new Map([...serverExports.values()].map((entry) => [entry.target, entry])).values();

  const entry = serverExports.get(specifierName(specifier) ?? '');

  return entry ? [entry] : [];
}

function edgeSpecifiers(node: any): any[] {
  if (node.specifiers?.length) return node.specifiers;

  let qualifier = node.qualifier;

  while (qualifier?.type === 'TSQualifiedName') qualifier = qualifier.left;

  if (qualifier?.name)
    return [{ type: 'ImportSpecifier', imported: qualifier, importKind: 'type' }];

  // Aggregate imports expose the whole facade, so check every underlying capability.
  return [{ type: 'ImportNamespaceSpecifier' }];
}

export function* serverExportEdges(node: any) {
  for (const specifier of edgeSpecifiers(node))
    for (const entry of specifierExports(specifier))
      yield {
        specifier,
        target: `#server/${entry.target}`,
        typeOnly: specifier.importKind === 'type' || specifier.exportKind === 'type'
      };
}
