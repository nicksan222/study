/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Requires schema decoding before parsed persisted JSON acquires a domain type.      │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Production server code directly casting global JSON.parse results or assigning them to   │
 * │ an explicit domain annotation. Tests and any/unknown annotations are exempt. This        │
 * │ catches direct parse expressions, not arbitrary aliases or the provenance of the JSON    │
 * │ string.                                                                                  │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { decodeBlockContent } from '@study/contracts/sources/document';                │
 * │   const body = decodeBlockContent(row.content);                                          │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import type { BlockContent } from '@study/contracts/sources/schemas';                  │
 * │   const body = JSON.parse(row.content) as BlockContent;                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { memberName as property, binding } from '../lexical-bindings.ts';
import { production } from './synchronous-transactions.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!production(context.filename)) return {};

    function unchecked(value: any): boolean {
      return (
        value?.type === 'CallExpression' &&
        property(value.callee) === 'parse' &&
        value.callee.object?.name === 'JSON' &&
        !binding(context, value.callee.object)?.defs.length
      );
    }

    function domain(type: any): boolean {
      return type && !['TSUnknownKeyword', 'TSAnyKeyword'].includes(type.type);
    }

    return {
      TSAsExpression(node) {
        if (domain(node.typeAnnotation) && unchecked(node.expression))
          context.report({
            node,
            message:
              'Decode persisted JSON with the canonical schema instead of asserting its domain type.'
          });
      },
      VariableDeclarator(node) {
        const id: any = node.id;

        if (domain(id.typeAnnotation?.typeAnnotation) && unchecked(node.init))
          context.report({
            node,
            message:
              'Decode persisted JSON with the canonical schema before assigning its domain type.'
          });
      }
    };
  }
});
