import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('rejects React Query across production, tests and reexports', async () => {
  const diagnostics = await lintRule(
    'web-query-contract',
    {
      'apps/client/src/routes/home.tsx': `import {useQuery} from '@tanstack/react-query';`,
      'apps/client/src/lib/state.test.ts': `import type {QueryClient} from '@tanstack/query-core';`,
      'packages/testing/src/query.ts': `export * from '@tanstack/react-query';`,
      'apps/client/src/lib/load.ts': `export const load = () => import('@tanstack/react-query');`
    },
    true
  );

  expect(diagnostics).toHaveLength(4);
});

testStable('keeps protocol execution in the application composition boundary', async () => {
  const diagnostics = await lintRule(
    'web-query-contract',
    {
      'apps/client/src/routes/home.tsx': `import {RpcClient} from 'effect/rpc';`,
      'apps/client/src/features/library/api.ts': `import {client} from '@study/server/client';`,
      'apps/client/src/features/library/load.ts': `import {runRequest} from '../../lib/effect/runtime';`,
      'apps/client/src/features/library/query.ts': `import {listSources} from '../../lib/study-client/operations';`
    },
    true
  );

  expect(diagnostics).toHaveLength(4);
});

testStable('allows canonical facade, local atoms, schemas and runtime composition', async () => {
  expect(
    await lintRule(
      'web-query-contract',
      {
        'apps/client/src/routes/home.tsx': `import {rpc} from '@study/contracts/react'; import {Atom} from 'effect/unstable/reactivity';`,
        'apps/client/src/features/editor/draft.ts': `import {Atom} from 'effect/reactivity'; import {useAtomValue} from '@effect/atom-react';`,
        'apps/client/src/lib/navigation/input.ts': `import {Schema} from 'effect';`,
        'apps/client/src/lib/effect/runtime.ts': `import {RpcClient} from 'effect/rpc';`,
        'packages/contracts/src/react.ts': `import {RpcClient} from 'effect/rpc'; import {useAtomValue} from '@effect/atom-react';`
      },
      true
    )
  ).toStrictEqual([]);
});

testStable('keeps React out of React-free protocol contracts', async () => {
  const diagnostics = await lintRule(
    'web-query-contract',
    {
      'packages/contracts/src/projects/rpc.ts': `import {useState} from 'react';`,
      'packages/contracts/src/rpc.ts': `export * from './react';`,
      'packages/contracts/src/sources/schemas.ts': `import {useAtomValue} from '@effect/atom-react';`
    },
    true
  );

  expect(diagnostics).toHaveLength(3);
});

testStable(
  'permits only the actual optional React modules and approved composition imports',
  async () => {
    const diagnostics = await lintRule(
      'web-query-contract',
      {
        'packages/contracts/src/react-state.ts': `import { useAtomValue } from '@effect/atom-react'; import { useState } from 'react';`,
        'packages/contracts/src/rpc.ts': `export * from './react-state';`,
        'packages/contracts/src/react-bypass.ts': `import { useState } from 'react';`,
        'apps/client/src/app/providers.tsx': `import { createRpcTransport } from '../lib/effect/rpc';`,
        'apps/client/src/lib/study-client/repeat-request.ts': `import { runRequest } from '../effect/runtime';`,
        'apps/client/src/features/notes/leak.ts': `import { createRpcTransport } from '../../lib/effect/rpc';`
      },
      true
    );

    expect(diagnostics).toHaveLength(3);
  }
);
