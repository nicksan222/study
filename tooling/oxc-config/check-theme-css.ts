import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cssColorViolations } from './plugin/theme-color-values.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

function check(directory: string): boolean {
  let failed = false;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) failed = check(path) || failed;
    else if (
      entry.name.endsWith('.css') &&
      relative(root, path).replaceAll('\\', '/') !== 'packages/ui/src/theme.css'
    ) {
      for (const violation of cssColorViolations(readFileSync(path, 'utf8'))) {
        process.stderr.write(`${relative(root, path)}: use a theme color: ${violation}\n`);
        failed = true;
      }
    }
  }

  return failed;
}

if (['apps/web/src', 'packages/ui/src'].map((path) => check(join(root, path))).some(Boolean))
  process.exitCode = 1;
