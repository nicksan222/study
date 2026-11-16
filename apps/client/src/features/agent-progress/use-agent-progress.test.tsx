import { executionIdSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { useAgentProgress } from './use-agent-progress';

testStable(
  'switching progress input ignores a late snapshot from the previous execution',
  async () => {
    let resolveOld!: (value: unknown) => void;
    const inputs: unknown[] = [];
    const fixture = rpcTestTransport(async (_tag, input) => {
      inputs.push(input);

      if (inputs.length === 1)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });

      return [];
    });
    const view = renderHook(
      ({ id }) => useAgentProgress({ executionId: executionIdSchema.make(id) }),
      {
        initialProps: { id: 'first' },
        wrapper: fixture.wrapper
      }
    );

    await waitFor(() => expect(inputs).toHaveLength(1));
    view.rerender({ id: 'second' });
    await waitFor(() => expect(inputs).toHaveLength(2));
    await act(async () => resolveOld([{ text: 'invalid obsolete snapshot' }]));
    expect(view.result.current.runs).toEqual([]);
    expect(view.result.current.isError).toBe(false);
  }
);
