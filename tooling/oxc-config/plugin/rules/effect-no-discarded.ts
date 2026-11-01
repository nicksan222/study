import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, effectProduction } from '../effect-bindings.ts';
import { pipeCall, enterNode, constantDeclarator } from '../lexical-bindings.ts';
import { callbackTarget } from './synchronous-transactions.ts';

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
      'flatten',
      'asVoid',
      'andThen',
      'callback',
      'forkIn',
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

      if (['Effect.void', 'Effect.never', 'Effect.yieldNow'].includes(bindings.resolve(node) ?? ''))
        return true;

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

      if (node.callee.type === 'CallExpression') {
        const operator = bindings.resolve(node.callee.callee);

        if (operator?.startsWith('Effect.') && constructors.has(operator.slice(7))) return true;

        if (effectWrapper(node.callee)) return true;
      }

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

    function effectWrapper(node: any): boolean {
      if (
        node?.type !== 'CallExpression' ||
        node.arguments.length !== 1 ||
        !callbackTarget(context, node.arguments[0])
      )
        return false;

      const api = bindings.resolve(node.callee);

      return (
        ['Effect.fn', 'Effect.fnUntraced', 'Effect.fnUntracedEager'].includes(api ?? '') ||
        (node.callee.type === 'CallExpression' &&
          bindings.resolve(node.callee.callee) === 'Effect.fn')
      );
    }

    function effectFunction(callee: any): boolean {
      if (callee.type !== 'Identifier') return false;

      const def = bindings.definition(callee);

      return constantDeclarator(def) && effectWrapper(def.init);
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
