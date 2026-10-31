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

      const entity = get(descriptor, 'entity');
      const singular = literal(get(entity, 'singular'));
      const plural = literal(get(entity, 'plural'));
      const make = value(field(descriptor, 'make'));
      let result = make?.body;

      if (result?.type === 'BlockStatement')
        result = result.body.find(
          (statement: any) => statement.type === 'ReturnStatement'
        )?.argument;

      const queries = get(value(result) ?? descriptor, 'queries');

      const mutations = get(value(result) ?? descriptor, 'mutations');

      checkConstructors(queries, mutations);
      checkQueries(queries, singular, plural);
    }

    function checkConstructors(queries: any, mutations: any) {
      for (const [operations, constructor] of [
        [queries, 'storeQuery'],
        [mutations, 'storeMutation']
      ] as const) {
        if (operations?.type !== 'ObjectExpression') continue;

        for (const item of operationFields(operations)) {
          if (item.type !== 'Property') continue;

          const operation = value(item.value);

          if (
            operation?.type !== 'CallExpression' ||
            !canonicalImport(context, operation.callee, 'define-store', constructor)
          )
            report(item, `Store operations must use the canonical ${constructor} constructor.`);
        }
      }
    }

    function checkQueries(queries: any, singular: string | null, plural: string | null) {
      if (queries?.type !== 'ObjectExpression') return;

      for (const item of operationFields(queries)) {
        if (!namedProperty(item)) continue;

        const name = propertyName(item.key);
        let operation = value(item.value);

        if (operation?.type === 'CallExpression') operation = value(operation.arguments[0]);

        if (operation?.type !== 'ObjectExpression') continue;

        checkQuery(item, operation, name, singular, plural);

        if (literal(get(operation, 'role')) === 'collection') collectionInput(item, operation);
      }
    }

    function queryName(role: string | null, singular: string | null, plural: string | null) {
      return role === 'required'
        ? singular
        : role === 'optional' && singular
          ? `find${singular[0].toUpperCase()}${singular.slice(1)}`
          : role === 'collection'
            ? plural
            : null;
    }

    function checkQuery(
      item: any,
      operation: any,
      name: string | null,
      singular: string | null,
      plural: string | null
    ) {
      const role = literal(get(operation, 'role'));
      const expected = queryName(role, singular, plural);

      if (
        (!field(operation, 'role') &&
          operation.properties.every((p: any) => p.type !== 'SpreadElement')) ||
        (role && !['required', 'optional', 'collection'].includes(role))
      )
        report(item, 'Store queries must use a required, optional, or collection role.');
      else if (expected && name && name !== expected)
        report(item, `The ${role} query must be named ${expected}.`);
    }

    function collectReturns(body: any, objects: any[]) {
      const visit = (part: any) => {
        if (!syntaxNode(part)) return;

        if (
          ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
            part.type
          )
        )
          return;

        if (part.type === 'ReturnStatement' && value(part.argument)?.type === 'ObjectExpression')
          objects.push(value(part.argument));

        for (const [key, child] of Object.entries(part)) {
          if (key === 'parent') continue;

          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
      };

      visit(body);
    }

    function service(node: any) {
      const make = value(node.arguments[1]);
      const objects: any[] = [];

      if (make?.type === 'ObjectExpression') objects.push(make);

      if (make?.type === 'CallExpression' && effects.resolve(make.callee) === 'Effect.gen') {
        const fn = make.arguments.at(-1);

        if (fn && ['FunctionExpression', 'ArrowFunctionExpression'].includes(fn.type)) {
          collectReturns(fn.body, objects);
        }
      }

      objects.forEach(checkServiceReads);
    }

    function checkServiceReads(object: any) {
      for (const item of object.properties) {
        if (!namedProperty(item)) continue;

        const name = propertyName(item.key);

        if (name && /^(?:get|list|fetch|all)(?:[A-Z]|$)/.test(name))
          report(item, 'Public service reads must use noun-based names.');
      }
    }

    return {
      ImportDeclaration: effects.imports,
      CallExpression(node: any) {
        if (isFactory(context, node.callee, 'store')) store(node);

        if (isFactory(context, node.callee, 'service')) service(node);
      }
    };
  }
});

function syntaxNode(part: any): boolean {
  return !!part && typeof part === 'object' && !!part.type;
}
