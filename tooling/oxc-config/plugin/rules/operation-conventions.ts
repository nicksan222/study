/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep store operations canonical, named and explicitly classified.                  │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents ad hoc query descriptors, malformed operation names and ambiguous query roles   │
 * │ in server production stores. Literal collection inputs need a numeric limit; opaque      │
 * │ composed schemas rely on the factory for runtime bounds.                                 │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { Schema } from 'effect';                                                       │
 * │   import { defineStore, storeQuery } from '#server/platform/definitions/define-store';   │
 * │   defineStore({                                                                          │
 * │     name: 'study/ExampleStore', entity: { singular: 'note', plural: 'notes' },           │
 * │     make: () => ({ queries: { readNote: storeQuery({                                     │
 * │       role: 'required', input: Schema.String, output: Schema.String, run: input => input │
 * │     }) }, mutations: {} })                                                               │
 * │   });                                                                                    │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { Schema } from 'effect';                                                       │
 * │   import { defineStore, storeQuery } from '#server/platform/definitions/define-store';   │
 * │   defineStore({                                                                          │
 * │     name: 'study/ExampleStore', entity: { singular: 'note', plural: 'notes' },           │
 * │     make: () => ({ queries: { readNote: storeQuery({                                     │
 * │       role: 'snapshot', input: Schema.String, output: Schema.String, run: input => input │
 * │     }) }, mutations: {} })                                                               │
 * │   });                                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { canonicalImport } from '../architecture-imports.ts';
import { effectBindings, propertyName } from '../effect-bindings.ts';
import { namedProperty } from '../lexical-bindings.ts';
import { property as field } from './effect-lifecycle-syntax.ts';
import { isFactory, resolveValue } from './module-factories.ts';
import { production } from './synchronous-transactions.ts';

const literal = (node: any) =>
  node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    const effects = effectBindings(context);
    const value = (node: any) => resolveValue(context, node);
    const get = (node: any, name: string) => value(field(value(node), name));
    const report = (node: any, message: string) => context.report({ node, message });

    function collectionInput(item: any, operation: any) {
      const input = get(operation, 'input');

      if (input?.type === 'CallExpression' && effects.resolve(input.callee) === 'Schema.Struct') {
        const shape = value(input.arguments[0]);

        if (
          shape?.type === 'ObjectExpression' &&
          ((!field(shape, 'limit') &&
            shape.properties.every((property: any) => property.type !== 'SpreadElement')) ||
            /^Schema\.(?:String|Boolean|Null|Undefined|Void|BigInt)$/.test(
              effects.resolve(value(field(shape, 'limit'))) ?? ''
            ))
        )
          report(
            item,
            'Collection query input must include a limit; the factory enforces its bounds.'
          );
      }
    }

    function operationFields(node: any, seen = new Set<any>()): any[] {
      const object = value(node);

      if (object?.type !== 'ObjectExpression' || seen.has(object)) return [];

      seen.add(object);

      return object.properties.flatMap((item: any) =>
        item.type === 'SpreadElement' ? operationFields(item.argument, seen) : [item]
      );
    }

    function store(node: any) {
      const descriptor = value(node.arguments[0]);

      if (descriptor?.type !== 'ObjectExpression') return;

      const make = value(field(descriptor, 'make'));
      let result = make?.body;

      if (result?.type === 'BlockStatement')
        result = result.body.find(
          (statement: any) => statement.type === 'ReturnStatement'
        )?.argument;

      const queries = get(value(result) ?? descriptor, 'queries');

      const mutations = get(value(result) ?? descriptor, 'mutations');

      checkConstructors(queries, mutations);
      checkQueries(queries);
    }

    function checkConstructors(queries: any, mutations: any) {
      for (const [operations, constructor] of [
        [queries, 'storeQuery'],
        [mutations, 'storeMutation']
      ] as const) {
        if (operations?.type !== 'ObjectExpression') continue;

        for (const item of operationFields(operations)) checkOperation(item, constructor);
      }
    }

    function checkOperation(item: any, constructor: string) {
      if (item.type !== 'Property') return;

      const name = propertyName(item.key);

      if (namedProperty(item) && (name === null || !/^[a-z][a-zA-Z0-9]*$/.test(name)))
        report(item, 'Store operation names must use lower camel case.');

      const operation = value(item.value);

      if (
        operation?.type !== 'CallExpression' ||
        !canonicalImport(context, operation.callee, 'define-store', constructor)
      )
        report(item, `Store operations must use the canonical ${constructor} constructor.`);
    }

    function checkQueries(queries: any) {
      if (queries?.type !== 'ObjectExpression') return;

      for (const item of operationFields(queries)) {
        if (!namedProperty(item)) continue;

        let operation = value(item.value);

        if (operation?.type === 'CallExpression') operation = value(operation.arguments[0]);

        if (operation?.type !== 'ObjectExpression') continue;

        checkQuery(item, operation);

        if (literal(get(operation, 'role')) === 'collection') collectionInput(item, operation);
      }
    }

    function checkQuery(item: any, operation: any) {
      const role = get(operation, 'role');

      if (
        (!field(operation, 'role') &&
          operation.properties.every((p: any) => p.type !== 'SpreadElement')) ||
        (role?.type === 'Literal' && !['required', 'optional', 'collection'].includes(role.value))
      )
        report(item, 'Store queries must use a required, optional, or collection role.');
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node: any) {
        if (isFactory(context, node.callee, 'store')) store(node);
      }
    };
  }
});
