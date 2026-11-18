import type { ModelUpdate } from '@study/contracts';
import { test } from '@study/testing';
import { toastManager } from '@study/ui';

import type * as NotificationComponent from '#client/app/model-update-notifications.tsx';

const first = {
  provider: 'chatgpt',
  family: 'sol',
  model: 'gpt-6.2-sol',
  previousModel: 'gpt-6.1-sol'
};

const next = { ...first, model: 'gpt-6.3-sol' };

let data: readonly ModelUpdate[] | undefined;

let dismiss: (notice: ModelUpdate) => Promise<unknown>;

let ModelUpdateNotifications: typeof NotificationComponent.ModelUpdateNotifications;

test.unit.beforeEach(async ({ mock }) => {
  mock('@study/contracts/react', () => ({
    rpc: {
      settings: {
        modelUpdates: { useQuery: () => ({ data }) },
        dismissModelUpdate: { useMutation: () => ({ mutate: dismiss }) }
      }
    }
  }));
  ModelUpdateNotifications = (await import('./model-update-notifications'))
    .ModelUpdateNotifications;
});

test.unit.stable(
  'announces each release once and dismisses the exact durable notice',
  async ({ render, act, expect, vi }) => {
    data = [first];
    dismiss = vi.fn(async () => ({}));
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('model-update');
    const view = render(<ModelUpdateNotifications />);

    expect(toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: 'New model version',
        description: 'Study switched from gpt-6.1-sol to gpt-6.2-sol.'
      })
    );
    data = [{ ...first }];
    view.rerender(<ModelUpdateNotifications />);
    expect(toast).toHaveBeenCalledTimes(1);
    await act(async () => toast.mock.calls[0]?.[0].onClose?.());
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(first);

    data = [next];
    view.rerender(<ModelUpdateNotifications />);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[1]?.[0].description).toContain(next.model);
  }
);
