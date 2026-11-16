/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Require an opening module-purpose comment in server production source.             │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents server modules from omitting a useful @file purpose before their first token.   │
 * │ Exempts tests, declarations and testing folders; placeholders do not qualify.            │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // apps/server/src/runtime/main.ts                                                     │
 * │   // Opening source text, with the comment delimiter split here:                         │
 * │   '/** @file Starts the private server. *' + '/\nexport {};'                             │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // apps/server/src/runtime/main.ts                                                     │
 * │   export {};                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

/** Require a module purpose without prescribing comment decoration or prose structure. */
export default defineRule({
  meta: {
    type: 'suggestion',
    docs: { description: 'Require a concise @file purpose in server production modules.' },
    messages: {
      description: 'Start server production modules with an @file comment describing their purpose.'
    }
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const cwd = context.cwd.replaceAll('\\', '/').replace(/\/$/, '');
    const path = filename.startsWith(cwd + '/') ? filename.slice(cwd.length) : filename;
    const workspace = path.match(/\/(?:apps|packages)\/[^/]+\//)?.[0];

    if (
      workspace !== '/apps/server/' ||
      !/\/apps\/server\/src\/.*\.[cm]?[jt]sx?$/.test(path) ||
      /\.(?:test|spec|d)\.[cm]?[jt]sx?$|\/(?:test|tests|__tests__|testing)\//.test(path)
    )
      return {};

    return {
      Program(node) {
        const source = context.sourceCode;
        const firstOffset = source.getFirstToken(node)?.range[0] ?? source.text.length;
        const documented = source.getAllComments().some((comment) => {
          if (comment.type !== 'Block' || comment.range[1] > firstOffset) return false;

          const purpose = /(?:^|\s)@file[ \t]+([^\n\r]*)/.exec(comment.value)?.[1]?.trim();

          return (
            !!purpose &&
            !purpose.startsWith('@') &&
            !/\b(?:TODO|TBD|FIXME)\b/i.test(purpose) &&
            /\p{L}/u.test(purpose)
          );
        });

        if (!documented) context.report({ loc: { line: 1, column: 0 }, messageId: 'description' });
      }
    };
  }
});
