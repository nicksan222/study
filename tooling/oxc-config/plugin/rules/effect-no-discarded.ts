import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const bindings = effectBindings(context);
    const message =
      'Consume Effect computations with yield*, return, or an approved runtime boundary.';
    const constructors = new Set([
      'gen',
      'succeed',
      'fail',
      'failCause',
      'sync',
      'suspend',
      'promise',
      'tryPromise',
      'try',
      'sleep',
      'yieldNow',
      'all',
      'forEach',
      'acquireRelease',
      'acquireUseRelease',
      'scoped',
      'map',
      'flatMap',
      'tap',
      'catch',
      'catchCause',
      'catchTag',
      'catchTags',
      'provide',
      'provideService',
      'withSpan',
      'log',
      'logInfo',
      'logError',
      'logWarning',
      'forkChild',
      'forkScoped',
      'forkDetach',
      'retry',
      'timeout'
    ]);

    function computation(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (['TSAsExpression', 'TSNonNullExpression', 'ChainExpression'].includes(node.type))
        return computation(node.expression, seen);

      if (['Effect.void', 'Effect.never'].includes(bindings.resolve(node) ?? '')) return true;

      if (node.type === 'Identifier') {
        const def = bindings.definition(node);

        return (
          def?.type === 'VariableDeclarator' &&
          def.parent?.kind === 'const' &&
          computation(def.init, seen)
        );
      }

      if (node.type !== 'CallExpression') return false;

      const name = bindings.resolve(node.callee);

      if (name?.startsWith('Effect.') && constructors.has(name.slice(7))) return true;

      if (
        node.callee.type === 'CallExpression' &&
        bindings.resolve(node.callee.callee) === 'Effect.fn'
      )
        return true;

      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'pipe'
      )
        return (
          !node.arguments.some((argument: any) =>
            /^Effect\.run(?:Promise|PromiseExit|Sync|SyncExit|Fork|Callback)$/.test(
              bindings.resolve(argument) ?? ''
            )
          ) && computation(node.callee.object, seen)
        );

      if (node.callee.type === 'Identifier') {
        const def = bindings.definition(node.callee);

        if (def?.type === 'VariableDeclarator' && def.init?.type === 'CallExpression') {
          const wrapper = bindings.resolve(def.init.callee);

          return (
            wrapper === 'Effect.fn' ||
            (def.init.callee.type === 'CallExpression' &&
              bindings.resolve(def.init.callee.callee) === 'Effect.fn')
          );
        }
      }

      return false;
    }

    return {
      ImportDeclaration: bindings.imports,
      UnaryExpression(node) {
        if (node.operator === 'void' && computation(node.argument))
          context.report({ node, message });
      },
      AwaitExpression(node) {
        if (computation(node.argument)) context.report({ node, message });
      },
      ExpressionStatement(node) {
        if (computation(node.expression)) context.report({ node, message });
      }
    };
  }
});
