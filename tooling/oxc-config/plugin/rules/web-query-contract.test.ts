import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('keeps Effects and runtime execution out of React and query definitions', () => {
  const diagnostics = lintRule(
    'web-query-contract',
    {
      'apps/web/src/app/shell/use-sidebar.ts': `import { Effect as E } from 'effect'; import { runRequest } from '../../lib/effect/runtime';`,
      'apps/web/src/features/library/library.queries.ts': `import * as E from 'effect/Effect';`,
      'apps/web/src/features/library/library.logic.ts': `export { Effect } from 'effect';`,
      'apps/web/src/pages/home/use-page.ts': `export const load = () => import('effect/Effect');`
    },
    true
  );

  assert.equal(diagnostics.length, 5, JSON.stringify(diagnostics));
});

test('requires shared query definitions rather than inline request functions', () => {
  const diagnostics = lintRule(
    'web-query-contract',
    {
      'apps/web/src/app/shell/use-sidebar.ts': `
      import { listProjects } from '../../lib/study-client/operations';
      import { queryOptions as options } from '@tanstack/react-query';
      const query = { queryFn: () => listProjects() };
      const mutation = { mutationFn: createProject };
    `
    },
    true
  );

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('allows Schema validation, type contracts, query adapters and startup appearance', () => {
  assert.deepEqual(
    lintRule(
      'web-query-contract',
      {
        'apps/web/src/lib/navigation/route-contract.ts': `import { Schema, type Effect } from 'effect';`,
        'apps/web/src/features/library/library.logic.ts': `import type { Sources } from '../../lib/study-client/operations';`,
        'apps/web/src/lib/study-client/operations.ts': `import { Effect } from 'effect'; import { runRequest } from '../effect/runtime';`,
        'apps/web/src/lib/appearance.ts': `import { loadAppearance } from './study-client/operations';`,
        'apps/web/src/features/library/library.queries.ts': `
      import { queryOptions } from '@tanstack/react-query';
      import { listSources } from '../../lib/study-client/operations';
      export const sources = () => queryOptions({ queryKey: ['sources'], queryFn: ({signal}) => listSources(signal) });
    `,
        'apps/web/src/app/shell/use-sidebar.ts': `import { useQuery } from '@tanstack/react-query'; import { sources } from '../../features/library';`,
        'apps/web/src/lib/effect/runtime.test.ts': `import { Effect } from 'effect';`
      },
      true
    ),
    []
  );
});

test('rejects nested generators including aliased Effect imports', () => {
  const diagnostics = lintRule(
    'web-query-contract',
    {
      'apps/web/src/lib/study-client/operations.ts': `
      import { Effect as E } from 'effect';
      export const task = E.gen(function* () {
        return yield* E.forEach(ids, (id) => E.gen(function* () { return yield* load(id); }));
      });
      export const flat = E.gen(function* () { return yield* load(); });
    `
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
