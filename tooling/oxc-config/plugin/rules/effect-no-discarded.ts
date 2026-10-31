import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';
import { pipeCall, enterNode, constantDeclarator } from '../lexical-bindings.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!effectProduction(context.filename)) return {};

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
      if (!enterNode(node, seen)) return false;

      if (['TSAsExpression', 'TSNonNullExpression', 'ChainExpression'].includes(node.type))
        return computation(node.expression, seen);

      if (['Effect.void', 'Effect.never'].includes(bindings.resolve(node) ?? '')) return true;

      if (node.type === 'Identifier') {
        const def = bindings.definition(node);

        return constantDeclarator(def) && computation(def.init, seen);
      }

      if (node.type !== 'CallExpression') return false;

      return computationCall(node, seen);
    }

    function computationCall(node: any, seen: Set<any>): boolean {
      const name = bindings.resolve(node.callee);

      if (name?.startsWith('Effect.') && constructors.has(name.slice(7))) return true;

      if (
        node.callee.type === 'CallExpression' &&
        bindings.resolve(node.callee.callee) === 'Effect.fn'
      )
        return true;

      if (pipeCall(node))
        return (
          !node.arguments.some((argument: any) =>
            /^Effect\.run(?:Promise|PromiseExit|Sync|SyncExit|Fork|Callback)$/.test(
              bindings.resolve(argument) ?? ''
            )
          ) && computation(node.callee.object, seen)
        );

      return effectFunction(node.callee);
    }

    function effectFunction(callee: any): boolean {
      if (callee.type === 'Identifier') {
        const def = bindings.definition(callee);

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
