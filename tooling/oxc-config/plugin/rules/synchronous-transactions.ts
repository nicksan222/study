import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport, targetPath } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import { walk } from './effect-lifecycle-syntax.ts';

export function production(filename: string): boolean {
  return (
    /\/apps\/server\/src\//.test(filename.replaceAll('\\', '/')) &&
    !/(?:\.test|\.spec|test-support)\.[cm]?[jt]sx?$/.test(filename)
  );
}

export function property(node: any): string | undefined {
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

export function resourceType(context: any, type: any, seen = new Set<any>()): string | undefined {
  if (!type || seen.has(type)) return;

  seen.add(type);

  if (type.type === 'TSTypeAnnotation') return resourceType(context, type.typeAnnotation, seen);

  if (type.type !== 'TSTypeReference') return;

  let root = type.typeName;
  const members: string[] = [];

  while (root?.type === 'TSQualifiedName') {
    members.unshift(root.right.name);
    root = root.left;
  }

  const def = binding(context, root)?.defs[0]?.node;

  if (def?.type === 'TSTypeAliasDeclaration')
    return resourceType(context, def.typeAnnotation, seen);

  if (!def?.parent || def.parent.type !== 'ImportDeclaration') return;

  const source = def.parent.source.value;
  const target = targetPath(context.filename, source);
  const name =
    def.type === 'ImportSpecifier'
      ? (def.imported.name ?? def.imported.value)
      : def.type === 'ImportNamespaceSpecifier'
        ? members[0]
        : undefined;

  if (source === '@study/db' && name === 'Db') return name;

  if (source === 'effect' && name === 'Clock') return name;

  if (target === 'runtime/context' && name === 'ServerContext') return name;

  if (target === 'platform/database/context' && name === 'ServerContext') return name;

  if (target === 'platform/definitions/define-store' && name === 'StoreResources') return name;
}

function storeFactory(
  context: any,
  node: any,
  seen = new Set<any>(),
  names = ['storeQuery', 'storeMutation']
): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);
  const native = (specifier: any) =>
    specifier?.parent?.type === 'ImportDeclaration' &&
    specifier.importKind !== 'type' &&
    specifier.parent.importKind !== 'type' &&
    targetPath(context.filename, specifier.parent.source.value) ===
      'platform/definitions/define-store';
  const def = binding(context, node)?.defs[0]?.node;

  if (def?.type === 'ImportSpecifier' && native(def))
    return names.includes(def.imported.name ?? def.imported.value);

  if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const')
    return storeFactory(context, def.init, seen, names);

  if (node.type === 'MemberExpression' && names.includes(property(node) ?? '')) {
    let object = node.object;
    const visited = new Set<any>();

    while (object && !visited.has(object)) {
      visited.add(object);
      const declaration = binding(context, object)?.defs[0]?.node;

      if (declaration?.type === 'ImportNamespaceSpecifier') return native(declaration);

      object =
        declaration?.type === 'VariableDeclarator' && declaration.parent?.kind === 'const'
          ? declaration.init
          : undefined;
    }
  }

  return false;
}

function boundDatabase(context: any, definition: any): boolean {
  const fn = definition.node;
  const pattern = fn?.params?.[0];

  if (!pattern || !['Identifier', 'ObjectPattern'].includes(pattern.type)) return false;

  const database =
    pattern.type === 'Identifier'
      ? pattern === definition.name
      : pattern.properties.find(
          (part: any) =>
            part.type === 'Property' &&
            (part.key.name ?? part.key.value) === 'db' &&
            (part.value === definition.name || part.value?.left === definition.name)
        );

  if (!database) return false;

  const type = pattern.typeAnnotation?.typeAnnotation;

  if (resourceType(context, type) === 'StoreResources') return true;

  let field = fn.parent;

  if (field?.type === 'VariableDeclarator' && field.id.type === 'Identifier') {
    const variable = binding(context, field.id);

    field = variable?.references.find(
      (ref: any) =>
        ref.identifier.parent?.type === 'Property' &&
        (ref.identifier.parent.key.name ?? ref.identifier.parent.key.value) === 'make'
    )?.identifier.parent;
  }

  function descriptorOwner(object: any, seen = new Set<any>()): boolean {
    if (!object || seen.has(object)) return false;

    seen.add(object);
    const parent = object.parent;

    if (parent?.type === 'CallExpression' && parent.arguments[0] === object)
      return storeFactory(context, parent.callee, new Set(), ['defineStore']);

    if (
      parent?.type === 'VariableDeclarator' &&
      parent.init === object &&
      parent.parent?.kind === 'const'
    )
      return (
        binding(context, parent.id)?.references.some((ref: any) =>
          descriptorOwner(ref.identifier, seen)
        ) ?? false
      );

    return false;
  }

  return (
    field?.type === 'Property' &&
    (field.key.name ?? field.key.value) === 'make' &&
    field.parent?.type === 'ObjectExpression' &&
    descriptorOwner(field.parent)
  );
}

export function typedOwner(context: any, node: any, seen = new Set<any>()): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);

  if (node.type === 'ThisExpression')
    return context.filename
      .replaceAll('\\', '/')
      .endsWith('/apps/server/src/platform/database/context.ts');

  if (node.type === 'MemberExpression') return typedOwner(context, node.object, seen);

  if (node.type !== 'Identifier') return false;

  return (
    binding(context, node)?.defs.some((definition: any) => {
      if (boundDatabase(context, definition)) return true;

      const declaration = definition.node;
      const annotation =
        declaration.type === 'VariableDeclarator'
          ? declaration.id.typeAnnotation
          : definition.name?.typeAnnotation;
      const type = annotation?.typeAnnotation;

      if (['Db', 'ServerContext', 'StoreResources'].includes(resourceType(context, type) ?? ''))
        return true;

      if (
        type?.type === 'TSTypeReference' &&
        imported(
          context,
          type.typeName,
          /(?:^@study\/db$|(?:runtime|platform\/database)\/context(?:\.ts)?$|platform\/definitions\/define-store(?:\.ts)?$)/
        )
      )
        return true;

      const init = declaration.init;

      if (
        declaration.type === 'VariableDeclarator' &&
        declaration.parent?.kind === 'const' &&
        (init?.type === 'Identifier' || init?.type === 'MemberExpression')
      ) {
        if (
          declaration.id.type === 'ObjectPattern' &&
          !declaration.id.properties.some(
            (part: any) =>
              part.type === 'Property' &&
              (part.key.name ?? part.key.value) === 'db' &&
              (part.value === definition.name || part.value?.left === definition.name)
          )
        )
          return false;

        return typedOwner(context, init, seen);
      }

      return (
        init?.type === 'CallExpression' &&
        property(init.callee) === 'open' &&
        imported(context, init.callee.object, /^@study\/db$/, 'Db')
      );
    }) ?? false
  );
}

export function transaction(context: any, node: any): boolean {
  return (
    node?.type === 'CallExpression' &&
    ((property(node.callee) === 'transaction' && typedOwner(context, node.callee.object)) ||
      canonicalImport(context, node.callee, 'define-store', 'transaction') ||
      canonicalImport(context, node.callee, 'define-store', 'publicationTransaction'))
  );
}

export function callbackTarget(context: any, node: any, seen = new Set<any>()): any {
  if (!node || seen.has(node)) return;

  seen.add(node);

  if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type))
    return node;

  if (node.type !== 'Identifier') return;

  const definition = binding(context, node)?.defs[0]?.node;

  if (definition?.type === 'FunctionDeclaration') return definition;

  if (definition?.type === 'VariableDeclarator' && definition.parent?.kind === 'const')
    return callbackTarget(context, definition.init, seen);
}

export function transactionCallbacks(context: any, program: any): Set<any> {
  const callbacks = new Set<any>();

  walk(program, (node: any) => {
    if (!transaction(context, node)) return;

    const callback = callbackTarget(context, node.arguments[0]);

    if (callback) callbacks.add(callback);
  });

  return callbacks;
}

export function transactionBody(_context: any, node: any, callbacks: Set<any>): boolean {
  let current = node.parent;

  while (current) {
    if (
      ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(
        current.type
      )
    )
      return callbacks.has(current);

    current = current.parent;
  }

  return false;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    const effects = effectBindings(context);
    let callbacks = new Set<any>();

    function deferred(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (node.type === 'Identifier') {
        const definition = binding(context, node)?.defs[0]?.node;

        return (
          definition?.type === 'VariableDeclarator' &&
          definition.parent?.kind === 'const' &&
          deferred(definition.init, seen)
        );
      }

      if (node.type !== 'CallExpression') return false;

      const api = effects.resolve(node.callee);

      if (
        api?.startsWith('Effect.') &&
        !['Effect.isEffect', 'Effect.runSync', 'Effect.runSyncExit'].includes(api)
      )
        return true;

      const object = node.callee.object;

      return object?.name === 'Promise' && !binding(context, object)?.defs.length;
    }

    return {
      ImportDeclaration: effects.imports,
      Program(node) {
        callbacks = transactionCallbacks(context, node);
      },
      CallExpression(node) {
        if (!transaction(context, node)) return;

        const callback = callbackTarget(context, node.arguments[0]);

        if (callback?.async || deferred(callback?.body))
          context.report({
            node: callback,
            message:
              'Transaction callbacks must execute synchronously; run Promise and Effect work outside the transaction.'
          });
      },
      ReturnStatement(node) {
        if (transactionBody(context, node, callbacks) && deferred(node.argument))
          context.report({
            node,
            message:
              'Transaction callbacks must execute synchronously; run Promise and Effect work outside the transaction.'
          });
      }
    };
  }
});
