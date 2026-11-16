import { executionIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import { useAgentProgress } from './use-agent-progress';

test.unit.stable(
  'switching progress input ignores a late snapshot from the previous execution',
  async ({ rpcTestTransport, renderHook, waitFor, expect, act }) => {
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
