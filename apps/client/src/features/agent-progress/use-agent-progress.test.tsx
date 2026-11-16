import { executionIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import { useAgentProgress } from './use-agent-progress';

test.stable(
  'switching progress input ignores a late snapshot from the previous execution',
  async () => {
    let resolveOld!: (value: unknown) => void;
    const inputs: unknown[] = [];
    const fixture = test.rpcTestTransport(async (_tag, input) => {
      inputs.push(input);

      if (inputs.length === 1)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });

      return [];
    });
    const view = test.renderHook(
      ({ id }) => useAgentProgress({ executionId: executionIdSchema.make(id) }),
      {
        initialProps: { id: 'first' },
        wrapper: fixture.wrapper
      }
    );

    await test.waitFor(() => test.expect(inputs).toHaveLength(1));
    view.rerender({ id: 'second' });
    await test.waitFor(() => test.expect(inputs).toHaveLength(2));
    await test.act(async () => resolveOld([{ text: 'invalid obsolete snapshot' }]));
    test.expect(view.result.current.runs).toEqual([]);
    test.expect(view.result.current.isError).toBe(false);
  }
);
