import { definePlugin } from 'vite-plus/lint/plugins';

import browserBoundary from './browser-boundary.ts';
import procedureTest from './procedure-test.ts';

export default definePlugin({
  meta: { name: 'study' },
  rules: { 'procedure-test': procedureTest, 'browser-boundary': browserBoundary }
});
