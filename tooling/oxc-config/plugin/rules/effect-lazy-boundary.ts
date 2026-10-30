import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, serverProduction } from '../effect-bindings.ts';
import {
  binding,
  memberName as property,
  constantAliasValue,
  lexicalResolver
} from '../lexical-bindings.ts';
import { property as field } from './effect-lifecycle-syntax.ts';
import { isFactory, resolveValue } from './module-factories.ts';
import { chain, databaseOrm } from './persistence-syntax.ts';
import { callbackTarget } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!serverProduction(context.filename)) return {};

    const effects = effectBindings(context);

    // Nested function bodies are deferred; inspecting them here would report pure closures.
    function immediate(node: any, visit: (node: any) => void): void {
      if (!immediateScope(node)) return;

      visit(node);

      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;

        if (Array.isArray(value)) for (const child of value) immediate(child, visit);
        else if (value && typeof value === 'object' && 'type' in value) immediate(value, visit);
      }
    }

    const resolve = lexicalResolver(resolvedIdentifier, resolveMember);

    function resolveMember(node: any, seen: Set<any>): string | null {
      const base = resolve(node.object, seen);
      const key = node.computed ? node.property.value : node.property.name;

      return base && key ? `${base}.${key}` : null;
    }

    function resolvedIdentifier(node: any, seen: Set<any>): string | null {
      const def = binding(context, node)?.defs[0]?.node;

      if (!def && ['Promise', 'JSON', 'Date', 'Math'].includes(node.name)) return node.name;

      const imported = filesystemImport(def);

      if (imported) return imported;

      return resolvedAlias(node, def, seen);
    }

    function resolvedAlias(node: any, def: any, seen: Set<any>): string | null {
      return constantAliasValue(def, seen, resolve, (pattern, base) => {
        const prop = pattern.properties.find((p: any) => p.value?.name === node.name);

        return base && prop ? `${base}.${prop.key.name}` : null;
      });
    }

    function promise(node: any): boolean {
      return (
        (node?.type === 'NewExpression' && resolve(node.callee) === 'Promise') ||
        (node?.type === 'CallExpression' &&
          (/^Promise\.(?:resolve|reject|all|allSettled|any|race|try)$/.test(
            resolve(node.callee) ?? ''
          ) ||
            callbackTarget(context, node.callee)?.async === true))
      );
    }

    function callbackPromise(node: any): boolean {
      const callback = callbackTarget(context, node);

      if (!callback) return false;

      let found = callback.async || promise(callback.body);

      immediate(callback.body, (part: any) => {
        if (part.type === 'ReturnStatement' && promise(part.argument)) found = true;
      });

      return found;
    }

    function fallibleSync(node: any): boolean {
      if (node?.type !== 'CallExpression') return false;

      const api = resolve(node.callee) ?? '';

      return (
        api === 'JSON.parse' ||
        /^fs\.(?:readFileSync|writeFileSync|appendFileSync|statSync|lstatSync|readdirSync|realpathSync|accessSync|openSync|mkdirSync|unlinkSync|renameSync|rmSync)$/.test(
          api
        )
      );
    }

    function knownIo(node: any): boolean {
      return (
        fallibleSync(node) ||
        (node?.type === 'CallExpression' &&
          ['Date.now', 'Math.random'].includes(resolve(node.callee) ?? ''))
      );
    }

    function checkStoreConstruction(node: any) {
      if (isFactory(context, node.callee, 'store')) {
        const descriptor = resolveValue(context, node.arguments[0]);
        const make = callbackTarget(context, field(descriptor, 'make'));

        if (make)
          immediate(make.body, (part: any) => {
            if (part.type !== 'CallExpression') return;

            if (databaseExecution(part))
              context.report({
                node: part,
                message: 'Keep database execution out of store construction.'
              });
          });
      }
    }

    function databaseExecution(part: any): boolean {
      const query = chain(context, part);

      return (
        (query && ['get', 'all', 'run'].includes(query.methods.at(-1)?.name ?? '')) ||
        (part.callee?.type === 'MemberExpression' &&
          ['get', 'all', 'run'].includes(property(part.callee) ?? '') &&
          databaseOrm(context, part.callee.object))
      );
    }

    function mappedPromise(node: any, arg: any): boolean {
      if (
        ['Promise.all', 'Promise.allSettled'].includes(resolve(node.callee) ?? '') &&
        arg?.type === 'CallExpression' &&
        arg.callee?.type === 'MemberExpression' &&
        (arg.callee.property as any)?.name === 'map' &&
        callbackPromise(arg.arguments[0])
      )
        return true;

      return false;
    }

    function uninterruptibleOutsideOwner(name: string | null): boolean {
      if (
        name === 'Effect.uninterruptible' &&
        !/\/src\/platform\/ai\/runtime\/resource(?:\.ts|\/[^/]+\.ts)$/.test(context.filename)
      )
        return true;

      return false;
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node) {
        checkStoreConstruction(node);

        const name = effects.resolve(node.callee);
        const arg = node.arguments[0];
        const tryArg = callbackArgument(name, arg);
        const cb = callbackTarget(context, tryArg);
        let bad = (name === 'Effect.sync' || name === 'Effect.try') && callbackPromise(tryArg);

        if (name === 'Effect.sync' && cb) {
          immediate(cb.body, (part: any) => {
            if (fallibleSync(part)) bad = true;
          });
        }

        if (name === 'Effect.succeed' && knownIo(arg)) bad = true;

        if (uninterruptibleOutsideOwner(name)) bad = true;

        if (mappedPromise(node, arg)) bad = true;

        if (bad)
          context.report({
            node,
            message: 'Keep Effect work lazy, synchronous where required, bounded and interruptible.'
          });
      }
    };
  }
});

function filesystemImport(def: any): string | null {
  if (def?.parent?.type === 'ImportDeclaration' && /^(?:node:)?fs$/.test(def.parent.source.value)) {
    if (def.type === 'ImportNamespaceSpecifier' || def.type === 'ImportDefaultSpecifier')
      return 'fs';

    if (def.type === 'ImportSpecifier') return `fs.${def.imported.name}`;
  }

  return null;
}

function callbackArgument(name: string | null, arg: any) {
  const tryArg =
    name === 'Effect.try' && arg?.type === 'ObjectExpression'
      ? (arg.properties as any[]).find((p: any) => p.key?.name === 'try')?.value
      : arg;

  return tryArg;
}

function immediateScope(node: any): boolean {
  return (
    !!node && typeof node === 'object' && !/^(?:Function|ArrowFunction|Class)/.test(node.type ?? '')
  );
}
