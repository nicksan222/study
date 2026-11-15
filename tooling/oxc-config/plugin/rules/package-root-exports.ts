/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Enforce library root imports and approved application facets.                      │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Deep imports couple consumers to library internals. App paths must also follow the       │
 * │ central package export policy.                                                           │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { StudyError } from '@study/contracts';                                         │
 * │   import { RpcProvider } from '@study/contracts/react';                                  │
 * │   import { createThemeStore } from '@study/theme';                                       │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { StudyError } from '@study/contracts/errors';                                  │
 * │   import { resolveTheme } from '@study/theme/internal';                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { isApprovedPackageSpecifier } from '../package-export-policy.ts';

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Require root-first library imports and approved application facets.' },
    messages: { path: '{{source}} is outside the approved public package export policy.' }
  },
  create(context) {
    return moduleEdges(context, (node, source) => {
      if (source === null || !source.startsWith('@study/') || isApprovedPackageSpecifier(source))
        return;

      context.report({ node, messageId: 'path', data: { source } });
    });
  }
});
