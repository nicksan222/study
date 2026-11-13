import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('keeps Effects and runtime execution out of React and query definitions', async () => {
  const diagnostics = await lintRule(
    'web-query-contract',
    {
      'apps/client/src/app/shell/use-sidebar.ts': `import { Effect as E } from 'effect'; import { runRequest } from '../../lib/effect/runtime';`,
      'apps/client/src/features/library/library.queries.ts': `import * as E from 'effect/Effect';`,
      'apps/client/src/features/library/library.logic.ts': `export { Effect } from 'effect';`,
      'apps/client/src/pages/home/use-page.ts': `export const load = () => import('effect/Effect');`
    },
    true
  );

  assert.strictEqual(diagnostics.length, 5, JSON.stringify(diagnostics));
});

testStable('requires shared query definitions rather than inline request functions', async () => {
  const diagnostics = await lintRule(
    'web-query-contract',
    {
      'apps/client/src/app/shell/use-sidebar.ts': `
      import { listProjects } from '../../lib/study-client/operations';
      import { queryOptions as options } from '@tanstack/react-query';
      const query = { queryFn: () => listProjects() };
      const mutation = { mutationFn: createProject };
    `
    },
    true
  );

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

testStable(
  'allows Schema validation, type contracts, query adapters and startup appearance',
  async () => {
    expect(
      await lintRule(
        'web-query-contract',
        {
          'apps/client/src/lib/navigation/route-contract.ts': `import { Schema, type Effect } from 'effect';`,
          'apps/client/src/features/library/library.logic.ts': `import type { Sources } from '../../lib/study-client/operations';`,
          'apps/client/src/lib/study-client/operations.ts': `import { Effect } from 'effect'; import { runRequest } from '../effect/runtime';`,
          'apps/client/src/lib/appearance.ts': `import { loadAppearance } from './study-client/operations';`,
          'apps/client/src/features/library/library.queries.ts': `
      import { queryOptions } from '@tanstack/react-query';
      import { listSources } from '../../lib/study-client/operations';
      export const sources = () => queryOptions({ queryKey: ['sources'], queryFn: ({signal}) => listSources(signal) });
    `,
          'apps/client/src/app/shell/use-sidebar.ts': `import { useQuery } from '@tanstack/react-query'; import { sources } from '../../features/library';`,
          'apps/client/src/lib/effect/runtime.test.ts': `import { Effect } from 'effect';`
        },
        true
      )
    ).toStrictEqual([]);
  }
);

testStable('rejects nested generators including aliased Effect imports', async () => {
  const diagnostics = await lintRule(
    'web-query-contract',
    {
      'apps/client/src/lib/study-client/operations.ts': `
      import { Effect as E } from 'effect';
      export const task = E.gen(function* () {
        return yield* E.forEach(ids, (id) => E.gen(function* () { return yield* load(id); }));
      });
      export const flat = E.gen(function* () { return yield* load(); });
    `
    },
    true
  );

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'Material pagination and import mutation definitions belong to shared query modules',
  async () => {
    assert.strictEqual(
      (
        await lintRule(
          'web-query-contract',
          {
            'apps/client/src/features/material-library/api.ts': `import {infiniteQueryOptions} from '@tanstack/react-query'; export const options = infiniteQueryOptions({queryFn: load});`,
            'apps/client/src/features/material-library/import-operation.ts': `import {useMutation} from '@tanstack/react-query'; export const useImport = () => useMutation({mutationFn: importSource});`
          },
          true
        )
      ).length,
      3
    );
    expect(
      await lintRule(
        'web-query-contract',
        {
          'apps/client/src/features/material-library/material-library.queries.ts': `import {infiniteQueryOptions, mutationOptions} from '@tanstack/react-query'; export const page = infiniteQueryOptions({queryFn: load}); export const imported = mutationOptions({mutationFn: importSource, retry: false});`,
          'apps/client/src/features/material-library/import-operation.ts': `import {useMutation} from '@tanstack/react-query'; import {importMutationOptions} from './material-library.queries'; export const useImport = () => useMutation(importMutationOptions());`
        },
        true
      )
    ).toStrictEqual([]);
  }
);

testStable(
  'creation recovery consumes shared infinite query options without moving page requests into the component',
  async () => {
    expect(
      await lintRule(
        'web-query-contract',
        {
          'apps/client/src/features/document-editing/creation-library-review.tsx': `
      import {useInfiniteQuery} from '@tanstack/react-query';
      import {materialsOptions} from '../material-library/material-library.queries';
      export function Review() { const library = useInfiniteQuery({...materialsOptions(), enabled: false}); return null; }
    `
        },
        true
      )
    ).toStrictEqual([]);
    const diagnostics = await lintRule(
      'web-query-contract',
      {
        'apps/client/src/features/document-editing/creation-library-review.tsx': `
      import {useInfiniteQuery} from '@tanstack/react-query';
      export function Review() { const library = useInfiniteQuery({queryKey: ['materials'], queryFn: () => loadPage()}); return null; }
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

testStable(
  'unavailable note reconciliation consumes shared selection, thread and generation options',
  async () => {
    expect(
      await lintRule(
        'web-query-contract',
        {
          'apps/client/src/features/note-workspace/unavailable-attempt.tsx': `
      import {useQueryClient} from '@tanstack/react-query';
      import {selectionOptions, threadOptions, noteGenerationsOptions} from './note-workspace.queries';
      export function Recovery() {
        const client = useQueryClient();
        return Promise.all([
          client.fetchQuery({...selectionOptions(id), staleTime: 0}),
          client.fetchInfiniteQuery({...threadOptions(id), staleTime: 0}),
          client.fetchInfiniteQuery({...noteGenerationsOptions(id), staleTime: 0})
        ]);
      }
    `
        },
        true
      )
    ).toStrictEqual([]);
    const diagnostics = await lintRule(
      'web-query-contract',
      {
        'apps/client/src/features/note-workspace/unavailable-attempt.tsx': `
      export const review = (client) => client.fetchInfiniteQuery({
        queryKey: ['note-generations'], queryFn: () => discoverRuns()
      });
    `
      },
      true
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);
