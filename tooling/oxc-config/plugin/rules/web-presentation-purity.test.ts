import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('views cannot fetch, run page hooks or own application state', () => {
  const diagnostics = lintRule(
    'web-presentation-purity',
    {
      'apps/web/src/pages/home/page.view.tsx': `import { useState as state } from 'react'; import { useNavigate } from '@tanstack/react-router'; import { Effect } from 'effect'; import { usePage } from './use-page'; import { load } from './page.logic';`,
      'apps/web/src/pages/home/page.logic.ts': `import { useState } from 'react'; import { Button } from '@study/ui/button'; import { Link } from '@tanstack/react-router';`,
      'apps/web/src/pages/home/other.logic.tsx': `export const element = <div />;`
    },
    true
  );

  assert.strictEqual(diagnostics.length, 9, JSON.stringify(diagnostics));
});

testStable('views accept presentation hooks, declarative links and type-only contracts', () => {
  expect(
    lintRule(
      'web-presentation-purity',
      {
        'apps/web/src/pages/home/page.view.tsx': `import { Link } from '@tanstack/react-router'; import { useI18n } from '../../lib/i18n'; import { useNowMinute } from '@study/ui/clock'; import type { Model } from './use-page'; export const PageView = () => <Link to="/Home" />;`,
        'apps/web/src/pages/home/page.logic.ts': `import { Effect } from 'effect'; import type { ReactNode } from 'react'; export const load = Effect.succeed(1);`
      },
      true
    )
  ).toStrictEqual([]);
});

testStable(
  'presentation cannot access browser globals or hide DOM mutations behind aliases',
  () => {
    const diagnostics = lintRule(
      'web-presentation-purity',
      {
        'apps/web/src/pages/home/page.view.tsx': `
      const storage = window.localStorage;
      export function PageView() {
        storage.setItem('key', 'value');
        document.body.classList.add('changed');
        localStorage.clear();
        globalThis.document.body.textContent = 'changed';
        return null;
      }
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

testStable('presentation permits shadowed names and prop callbacks', () => {
  expect(
    lintRule(
      'web-presentation-purity',
      {
        'apps/web/src/pages/home/page.view.tsx': `
      export function PageView({ document, onClick }) {
        return <button onClick={onClick}>{document.title}</button>;
      }
    `
      },
      true
    )
  ).toStrictEqual([]);
});

testStable('extension-correct localization aliases remain presentation-safe', () => {
  const diagnostics = lintRule(
    'web-presentation-purity',
    {
      'apps/web/src/pages/home/page.view.tsx': "import {useI18n} from '#web/lib/i18n.tsx';",
      'apps/web/src/pages/settings/page.view.tsx':
        "import {useSettings} from '#web/lib/use-settings.ts';"
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
