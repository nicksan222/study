import { defineRule } from 'vite-plus/lint/plugins';

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

export function typedOwner(context: any, node: any, seen = new Set<any>()): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);

  if (node.type === 'ThisExpression')
    return context.filename.replaceAll('\\', '/').endsWith('/apps/server/src/runtime/context.ts');

  if (node.type === 'MemberExpression') return typedOwner(context, node.object, seen);

  if (node.type !== 'Identifier') return false;

  return (
    binding(context, node)?.defs.some((definition: any) => {
      const declaration = definition.node;
      const annotation =
        declaration.type === 'VariableDeclarator'
          ? declaration.id.typeAnnotation
          : definition.name?.typeAnnotation;
      const type = annotation?.typeAnnotation;

      if (
        type?.type === 'TSTypeReference' &&
        imported(context, type.typeName, /(?:^@study\/db$|runtime\/context$)/)
      )
        return true;

      const init = declaration.init;

      if (
        declaration.type === 'VariableDeclarator' &&
        declaration.parent?.kind === 'const' &&
        (init?.type === 'Identifier' || init?.type === 'MemberExpression')
      )
        return typedOwner(context, init, seen);

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
    property(node.callee) === 'transaction' &&
    typedOwner(context, node.callee.object)
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
