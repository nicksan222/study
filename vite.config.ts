import { defineConfig } from 'vite-plus';

import { fmt } from './tooling/oxc-config/fmt.ts';
import { lint } from './tooling/oxc-config/lint.ts';

export default defineConfig({ fmt, lint, test: { projects: ['apps/web'] } });
