/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Require explanations and contrasting examples at the start of custom lint rules.   │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Undocumented restrictions from entering the Study plugin. Rule implementations need one  │
 * │ leading framed JSDoc with a purpose, prevented failure and both examples; helpers and    │
 * │ tests are exempt.                                                                        │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // Framed JSDoc: @file purpose, Prevents:, Allowed: and Rejected: sections.            │
 * │   export default defineRule({ create() { return {}; } });                                │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // No leading guide explaining the rule or its examples.                               │
 * │   export default defineRule({ create() { return {}; } });                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { imported, memberName } from '../lexical-bindings.ts';

const width = 88;

const top = ' * ╭' + '─'.repeat(width + 2) + '╮';

const bottom = ' * ╰' + '─'.repeat(width + 2) + '╯';

function completeGuide(comment: string): boolean {
  const lines = comment.replaceAll('\r\n', '\n').split('\n');

  if (lines[0] !== '/**' || lines[1] !== top || lines.at(-2) !== bottom || lines.at(-1) !== ' */')
    return false;

  const rows = lines.slice(2, -2);

  if (
    rows.some(
      (row) => !row.startsWith(' * │ ') || !row.endsWith(' │') || [...row].length !== width + 7
    )
  )
    return false;

  const text = rows
    .map((row) => row.slice(5, -2).trimEnd())
    .join('\n')
    .trim();
  const sections =
    /^@file[ \t]+([\s\S]*?)\n+Prevents:\n([\s\S]*?)\n+Allowed:\n([\s\S]*?)\n+Rejected:\n([\s\S]*)$/.exec(
      text
    );

  return !!sections && sections.slice(1).every((section) => section.trim().length > 0);
}

export default defineRule({
  meta: {
    type: 'suggestion',
    docs: { description: 'Require framed rule explanations with allowed and rejected examples.' },
    messages: {
      guide:
        'Start lint rule implementations with a framed @file guide: Prevents:, Allowed: and Rejected: sections, 88-column padded content, │ sides and ╭/╰ borders of 90 ─ characters.'
    }
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (
      !filename.includes('/tooling/oxc-config/plugin/') ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests|__tests__)\//.test(filename)
    )
      return {};

    const plugin = /^vite-plus\/lint\/plugins$/;
    let checked = false;

    return {
      CallExpression(node) {
        if (checked) return;

        const factory =
          imported(context, node.callee, plugin, 'defineRule') ||
          (node.callee.type === 'MemberExpression' &&
            memberName(node.callee) === 'defineRule' &&
            imported(context, node.callee.object, plugin));

        if (!factory) return;

        checked = true;
        const source = context.sourceCode;
        const firstOffset = source.getFirstToken(source.ast)?.range[0] ?? source.text.length;
        const documented = source
          .getAllComments()
          .some(
            (comment) =>
              comment.type === 'Block' &&
              comment.range[1] <= firstOffset &&
              source.text.slice(comment.range[0], comment.range[0] + 3) === '/**' &&
              completeGuide(source.text.slice(...comment.range))
          );

        if (!documented) context.report({ loc: { line: 1, column: 0 }, messageId: 'guide' });
      }
    };
  }
});
