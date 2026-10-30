import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings, propertyName } from '../effect-bindings.ts';
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

      if (queries?.type !== 'ObjectExpression') return;

      for (const item of queries.properties) {
        if (item.type !== 'Property' || (item.computed && item.key.type !== 'Literal')) continue;

        const name = propertyName(item.key);
        let operation = value(item.value);

        if (operation?.type === 'CallExpression') operation = value(operation.arguments[0]);

        if (operation?.type !== 'ObjectExpression') continue;

        const role = literal(get(operation, 'role'));
        const expected =
          role === 'required'
            ? singular
            : role === 'optional' && singular
              ? `find${singular[0].toUpperCase()}${singular.slice(1)}`
              : role === 'collection'
                ? plural
                : null;

        if (
          (!field(operation, 'role') &&
            operation.properties.every((p: any) => p.type !== 'SpreadElement')) ||
          (role && !['required', 'optional', 'collection'].includes(role))
        )
          report(item, 'Store queries must use a required, optional, or collection role.');
        else if (expected && name && name !== expected)
          report(item, `The ${role} query must be named ${expected}.`);

        if (role === 'collection') {
          const input = get(operation, 'input');

          if (
            input?.type === 'CallExpression' &&
            effects.resolve(input.callee) === 'Schema.Struct'
          ) {
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
      }
    }

    function service(node: any) {
      const make = value(node.arguments[1]);
      const objects: any[] = [];

      if (make?.type === 'ObjectExpression') objects.push(make);

      if (make?.type === 'CallExpression' && effects.resolve(make.callee) === 'Effect.gen') {
        const fn = make.arguments.at(-1);

        if (fn && ['FunctionExpression', 'ArrowFunctionExpression'].includes(fn.type)) {
          const visit = (part: any) => {
            if (!part || typeof part !== 'object' || !part.type) return;

            if (
              ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
                part.type
              )
            )
              return;

            if (
              part.type === 'ReturnStatement' &&
              value(part.argument)?.type === 'ObjectExpression'
            )
              objects.push(value(part.argument));

            for (const [key, child] of Object.entries(part)) {
              if (key === 'parent') continue;

              if (Array.isArray(child)) child.forEach(visit);
              else visit(child);
            }
          };

          visit(fn.body);
        }
      }

      for (const object of objects)
        for (const item of object.properties) {
          if (item.type !== 'Property' || (item.computed && item.key.type !== 'Literal')) continue;

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
