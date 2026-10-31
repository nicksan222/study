import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport, targetPath } from '../architecture-imports.ts';
import { effectBindings } from '../effect-bindings.ts';
import {
  binding,
  imported,
  memberName as property,
  constantDeclarator,
  runtimeImport,
  enterNode
} from '../lexical-bindings.ts';
import { walk } from './effect-lifecycle-syntax.ts';

export function production(filename: string): boolean {
  return (
    /\/apps\/server\/src\//.test(filename.replaceAll('\\', '/')) &&
    !/(?:\.test|\.spec|test-support)\.[cm]?[jt]sx?$/.test(filename)
  );
}

export function resourceType(context: any, type: any, seen = new Set<any>()): string | undefined {
  if (!enterNode(type, seen)) return;

  if (type.type === 'TSTypeAnnotation') return resourceType(context, type.typeAnnotation, seen);

  if (type.type !== 'TSTypeReference') return;

  const { root, members } = qualifiedType(type);

  const def = binding(context, root)?.defs[0]?.node;

  if (def?.type === 'TSTypeAliasDeclaration')
    return resourceType(context, def.typeAnnotation, seen);

  if (!def?.parent || def.parent.type !== 'ImportDeclaration') return;

  return importedResource(context, def, members);
}

function importedResource(context: any, def: any, members: string[]): string | undefined {
  const source = def.parent.source.value;
  const target = targetPath(context.filename, source);
  const name =
    def.type === 'ImportSpecifier'
      ? (def.imported.name ?? def.imported.value)
      : def.type === 'ImportNamespaceSpecifier'
        ? members[0]
        : undefined;

  const resources: Record<string, string> = {
    '@study/db': 'Db',
    effect: 'Clock',
    'runtime/context': 'ServerContext',
    'platform/database/context': 'ServerContext',
    'platform/definitions/define-store': 'StoreResources'
  };
  const key = ['@study/db', 'effect'].includes(source) ? source : target;

  if (key !== null && resources[key] === name) return name;
}

function storeFactory(
  context: any,
  node: any,
  seen = new Set<any>(),
  names = ['storeQuery', 'storeMutation']
): boolean {
  if (!enterNode(node, seen)) return false;

  const native = (specifier: any) =>
    runtimeImport(specifier) &&
    targetPath(context.filename, specifier.parent.source.value) ===
      'platform/definitions/define-store';
  const def = binding(context, node)?.defs[0]?.node;

  if (nativeSpecifier(def, native)) return names.includes(def.imported.name ?? def.imported.value);

  if (constantDeclarator(def)) return storeFactory(context, def.init, seen, names);

  if (node.type === 'MemberExpression' && names.includes(property(node) ?? ''))
    return storeNamespace(context, node.object, native);

  return false;
}

function storeNamespace(context: any, object: any, native: (node: any) => boolean): boolean {
  const visited = new Set<any>();

  while (object && !visited.has(object)) {
    visited.add(object);
    const declaration = binding(context, object)?.defs[0]?.node;

    if (declaration?.type === 'ImportNamespaceSpecifier') return native(declaration);

    object = constantDeclarator(declaration) ? declaration.init : undefined;
  }

  return false;
}

function boundDatabase(context: any, definition: any): boolean {
  const fn = definition.node;
  const pattern = fn?.params?.[0];

  if (!pattern || !['Identifier', 'ObjectPattern'].includes(pattern.type)) return false;

  const database = databaseParameter(pattern, definition);

  if (!database) return false;

  const type = pattern.typeAnnotation?.typeAnnotation;

  if (resourceType(context, type) === 'StoreResources') return true;

  const field = makeField(context, fn);

  return storeMakeField(context, field);
}

function storeMakeField(context: any, field: any): boolean {
  return (
    field?.type === 'Property' &&
    (field.key.name ?? field.key.value) === 'make' &&
    field.parent?.type === 'ObjectExpression' &&
    descriptorOwner(context, field.parent)
  );
}

function databaseParameter(pattern: any, definition: any) {
  return pattern.type === 'Identifier'
    ? pattern === definition.name
    : pattern.properties.find(
        (part: any) =>
          part.type === 'Property' &&
          (part.key.name ?? part.key.value) === 'db' &&
          (part.value === definition.name || part.value?.left === definition.name)
      );
}

export function typedOwner(context: any, node: any, seen = new Set<any>()): boolean {
  if (!enterNode(node, seen)) return false;

  if (node.type === 'ThisExpression')
    return context.filename
      .replaceAll('\\', '/')
      .endsWith('/apps/server/src/platform/database/context.ts');

  if (node.type === 'MemberExpression') return typedOwner(context, node.object, seen);

  if (node.type !== 'Identifier') return false;

  return (
    binding(context, node)?.defs.some((definition: any) => {
      if (boundDatabase(context, definition)) return true;

      return definitionOwner(context, definition, seen);
    }) ?? false
  );
}

function definitionOwner(context: any, definition: any, seen: Set<any>): boolean {
  const declaration = definition.node;

  if (annotatedOwner(context, definition)) return true;

  if (constantDeclarator(declaration)) return aliasedOwner(context, definition, seen);

  return openedDatabase(context, declaration.init);
}

function aliasedOwner(context: any, definition: any, seen: Set<any>): boolean {
  const declaration = definition.node;
  const init = declaration.init;

  if (init?.type === 'Identifier' || init?.type === 'MemberExpression') {
    if (declaration.id.type === 'ObjectPattern' && !databaseParameter(declaration.id, definition))
      return false;

    return typedOwner(context, init, seen);
  }

  return openedDatabase(context, init);
}

function openedDatabase(context: any, init: any): boolean {
  return (
    init?.type === 'CallExpression' &&
    property(init.callee) === 'open' &&
    imported(context, init.callee.object, /^@study\/db$/, 'Db')
  );
}

function annotatedOwner(context: any, definition: any): boolean {
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

  return false;
}

function transaction(context: any, node: any): boolean {
  return (
    node?.type === 'CallExpression' &&
    ((property(node.callee) === 'transaction' && typedOwner(context, node.callee.object)) ||
      canonicalImport(context, node.callee, 'define-store', 'transaction') ||
      canonicalImport(context, node.callee, 'define-store', 'publicationTransaction'))
  );
}

export function callbackTarget(context: any, node: any, seen = new Set<any>()): any {
  if (!enterNode(node, seen)) return;

  if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type))
    return node;

  if (node.type !== 'Identifier') return;

  const definition = binding(context, node)?.defs[0]?.node;

  if (definition?.type === 'FunctionDeclaration') return definition;

  if (constantDeclarator(definition)) return callbackTarget(context, definition.init, seen);
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
      if (!enterNode(node, seen)) return false;

      if (node.type === 'Identifier') {
        const definition = binding(context, node)?.defs[0]?.node;

        return constantDeclarator(definition) && deferred(definition.init, seen);
      }

      if (node.type !== 'CallExpression') return false;

      if (deferredEffect(effects.resolve(node.callee))) return true;

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

function descriptorOwner(context: any, object: any, seen = new Set<any>()): boolean {
  if (!enterNode(object, seen)) return false;

  const parent = object.parent;

  if (parent?.type === 'CallExpression' && parent.arguments[0] === object)
    return storeFactory(context, parent.callee, new Set(), ['defineStore']);

  if (constantDeclarator(parent) && parent.init === object)
    return (
      binding(context, parent.id)?.references.some((ref: any) =>
        descriptorOwner(context, ref.identifier, seen)
      ) ?? false
    );

  return false;
}

function deferredEffect(api: string | null | undefined): boolean {
  return (
    !!api?.startsWith('Effect.') &&
    !['Effect.isEffect', 'Effect.runSync', 'Effect.runSyncExit'].includes(api)
  );
}

function qualifiedType(type: any) {
  let root = type.typeName;
  const members: string[] = [];

  while (root?.type === 'TSQualifiedName') {
    members.unshift(root.right.name);
    root = root.left;
  }

  return { root, members };
}

function makeField(context: any, fn: any) {
  let field = fn.parent;

  if (field?.type === 'VariableDeclarator' && field.id.type === 'Identifier') {
    const variable = binding(context, field.id);

    field = variable?.references.find(
      (ref: any) =>
        ref.identifier.parent?.type === 'Property' &&
        (ref.identifier.parent.key.name ?? ref.identifier.parent.key.value) === 'make'
    )?.identifier.parent;
  }

  return field;
}

function nativeSpecifier(def: any, native: (node: any) => boolean): boolean {
  return def?.type === 'ImportSpecifier' && native(def);
}
