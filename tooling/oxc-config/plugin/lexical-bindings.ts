export function memberName(node: any): string | undefined {
  return node?.type === 'MemberExpression'
    ? !node.computed && node.property.type === 'Identifier'
      ? node.property.name
      : node.property.value
    : undefined;
}

export function binding(context: any, node: any): any {
  if (node?.type !== 'Identifier') return;

  let scope = context.sourceCode.getScope(node);

  while (scope) {
    const variable = scope.set.get(node.name);

    if (variable) return variable;

    scope = scope.upper;
  }
}

export function imported(context: any, node: any, source: RegExp, name?: string): boolean {
  return (
    binding(context, node)?.defs.some((definition: any) => {
      const specifier = definition.node;
      const declaration = specifier.parent;

      return (
        declaration?.type === 'ImportDeclaration' &&
        source.test(declaration.source.value) &&
        (!name || specifier.imported?.name === name || specifier.imported?.value === name)
      );
    }) ?? false
  );
}

export function constantDeclarator(node: any): boolean {
  return node?.type === 'VariableDeclarator' && node.parent?.kind === 'const';
}

export function runtimeImport(node: any): boolean {
  return (
    node?.parent?.type === 'ImportDeclaration' &&
    node.parent.importKind !== 'type' &&
    node.importKind !== 'type'
  );
}

export function staticMember(node: any): boolean {
  return node.type === 'MemberExpression' && (!node.computed || node.property.type === 'Literal');
}

export function namedProperty(node: any): boolean {
  return node.type === 'Property' && (!node.computed || node.key.type === 'Literal');
}

export function pipeCall(node: any): boolean {
  return (
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'pipe'
  );
}

/** Enter each syntax node once while following lexical aliases. */
export function enterNode(node: any, seen: Set<any>): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);

  return true;
}

/** Resolve lexical identifiers and member paths with one shared alias cycle guard. */
export function lexicalResolver(
  identifier: (node: any, seen: Set<any>) => string | null,
  member: (node: any, seen: Set<any>) => string | null
) {
  return (node: any, seen = new Set<any>()): string | null => {
    if (!enterNode(node, seen)) return null;

    if (node.type === 'Identifier') return identifier(node, seen);

    if (node.type === 'MemberExpression') return member(node, seen);

    return null;
  };
}

export function destructuredBinding(pattern: any, name: string): any {
  return pattern.properties.find(
    (part: any) => part.type === 'Property' && (part.value.name ?? part.value.left?.name) === name
  );
}

export function globalMember(context: any, node: any, objects: string[], names: string[]): boolean {
  return (
    staticMember(node) &&
    node.object.type === 'Identifier' &&
    objects.includes(node.object.name) &&
    !binding(context, node.object)?.defs[0]?.node &&
    names.includes(memberName(node) ?? '')
  );
}

/** Resolve a constant's value before interpreting any destructured binding. */
export function constantAliasValue(
  declaration: any,
  seen: Set<any>,
  resolve: (node: any, seen: Set<any>) => string | null,
  destructure: (pattern: any, base: string | null) => string | null
): string | null {
  if (!constantDeclarator(declaration)) return null;

  const base = resolve(declaration.init, seen);

  if (declaration.id.type === 'Identifier') return base;

  if (declaration.id.type === 'ObjectPattern') return destructure(declaration.id, base);

  return null;
}

/** Match a reference to the specific lexical declaration that introduced it. */
export function boundSpecifier(context: any, node: any, specifier: any): boolean {
  return Boolean(
    specifier &&
    binding(context, node)?.defs.some((definition: any) => definition.node === specifier)
  );
}
