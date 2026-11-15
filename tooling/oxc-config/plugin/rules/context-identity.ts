/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Preserve native Context.Service identity keys.                                     │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents assignment to a resolved Context.Service key, including Object.assign through   │
 * │ constant aliases; attaching other properties is allowed. This rule has no path           │
 * │ restriction.                                                                             │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { Context } from 'effect';                                                      │
 * │   const tag = Context.Service('study/X');                                                │
 * │   Object.assign(tag, { layer });                                                         │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { Context } from 'effect';                                                      │
 * │   const tag = Context.Service('study/X');                                                │
 * │   tag.key = other;                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { effectBindings } from '../effect-bindings.ts';
import { binding, memberName as property } from '../lexical-bindings.ts';
import { resolveValue } from './module-factories.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const effects = effectBindings(context);

    function tag(node: any): boolean {
      const value = resolveValue(context, node);

      return (
        value?.type === 'CallExpression' && effects.resolve(value.callee) === 'Context.Service'
      );
    }

    function report(node: any) {
      context.report({
        node,
        message: 'Do not overwrite the native Context service identity key.'
      });
    }

    return {
      ImportDeclaration: effects.imports,
      AssignmentExpression(node: any) {
        if (property(node.left) === 'key' && tag(node.left.object)) report(node);
      },
      CallExpression(node: any) {
        if (
          property(node.callee) !== 'assign' ||
          node.callee.object?.name !== 'Object' ||
          binding(context, node.callee.object)?.defs.length ||
          !tag(node.arguments[0])
        )
          return;

        if (
          node.arguments.slice(1).some((arg: any) => {
            const value = resolveValue(context, arg);

            return (
              value?.type === 'ObjectExpression' &&
              value.properties.some(
                (item: any) =>
                  item.type === 'Property' && (item.key.name ?? item.key.value) === 'key'
              )
            );
          })
        )
          report(node);
      }
    };
  }
});
