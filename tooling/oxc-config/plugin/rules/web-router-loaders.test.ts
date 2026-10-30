import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('library and practice routes declare loading and search dependencies', () => {
  const diagnostics = lintRule(
    'web-router-loaders',
    {
      'apps/web/src/routes/MediaList.tsx': `import { createFileRoute as route } from '@tanstack/react-router'; export const Route = route('/MediaList')({ staticData: {section: 'library'}, component: Page });`,
      'apps/web/src/routes/Practice.tsx': `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/Practice')({ staticData: {section: 'practice'}, loader: load, component: Page });`
    },
    true
  );

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('allows loaded routes, redirects, and pages without data requirements', () => {
  assert.deepEqual(
    lintRule(
      'web-router-loaders',
      {
        'apps/web/src/routes/MediaList.tsx': `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/MediaList')({ staticData: {section: 'library'}, loaderDeps: deps, loader: load, component: Page });`,
        'apps/web/src/routes/index.tsx': `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ beforeLoad: redirect });`,
        'apps/web/src/routes/Help.tsx': `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/Help')({ component: Page });`
      },
      true
    ),
    []
  );
});
