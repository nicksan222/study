import { definePlugin } from 'vite-plus/lint/plugins';

import browserBoundary from './rules/browser-boundary.ts';
import databaseOwnership from './rules/database-ownership.ts';
import effectV4Api from './rules/effect-v4-api.ts';
import packageBoundary from './rules/package-boundary.ts';
import procedureContract from './rules/procedure-contract.ts';
import procedureTest from './rules/procedure-test.ts';
import serverNoMocks from './rules/server-no-mocks.ts';
import sharedUiVariants from './rules/shared-ui-variants.ts';
import themeRule from './rules/theme-colors.ts';

export default definePlugin({
  meta: { name: 'study' },
  rules: {
    'server-no-mocks': serverNoMocks,
    'database-ownership': databaseOwnership,
    'effect-v4-api': effectV4Api,
    'procedure-contract': procedureContract,
    'procedure-test': procedureTest,
    'browser-boundary': browserBoundary,
    'package-boundary': packageBoundary,
    'theme-colors': themeRule,
    'shared-ui-variants': sharedUiVariants
  }
});
