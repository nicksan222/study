import type { ModelUpdate } from '@study/contracts';
import { test } from '@study/testing';
import { toastManager } from '@study/ui';

import type * as NotificationComponent from '#client/app/model-update-notifications.tsx';

const first = {
  provider: 1,
  tier: 'medium',
  model: 'gpt-6.2-sol',
  previousModel: 'gpt-6.1-sol'
} as const;

const next = { ...first, model: 'gpt-6.3-sol' };

let data: readonly ModelUpdate[] | undefined;

let apply: (notice: ModelUpdate) => Promise<unknown>;

let dismiss: (notice: ModelUpdate) => Promise<unknown>;

let ModelUpdateNotifications: typeof NotificationComponent.ModelUpdateNotifications;

test.unit.beforeEach(async ({ mock }) => {
  mock('@study/contracts/react', () => ({
    rpc: {
      settings: {
        modelUpdates: { useQuery: () => ({ data }) },
        dismissModelUpdate: { useMutation: () => ({ mutate: dismiss }) },
        applyModelUpdate: { useMutation: () => ({ mutate: apply }) }
      }
    }
  }));
  ModelUpdateNotifications = (await import('./model-update-notifications'))
    .ModelUpdateNotifications;
});

test.unit.stable(
  'announces each release once and dismisses the exact durable notice',
  async ({ render, act, expect, vi, rpcTestTransport }) => {
    const { transport } = rpcTestTransport(async () => []);

    data = [first];
    apply = vi.fn(async () => ({}));
    dismiss = vi.fn(async () => ({}));
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('model-update');
    const view = render(<ModelUpdateNotifications transport={transport} />);

    expect(toast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: 'New model version',
        description: 'Everyday tasks can use gpt-6.2-sol. Replace gpt-6.1-sol?'
      })
    );
    expect(apply).not.toHaveBeenCalled();
    data = [{ ...first }];
    view.rerender(<ModelUpdateNotifications transport={transport} />);
    expect(toast).toHaveBeenCalledTimes(1);
    await act(async () => toast.mock.calls[0]?.[0].onClose?.());
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(first);

    data = [next];
    view.rerender(<ModelUpdateNotifications transport={transport} />);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[1]?.[0].description).toContain(next.model);
    await act(async () => toast.mock.calls[1]?.[0].actionProps?.onClick?.({} as never));
    expect(apply).toHaveBeenCalledExactlyOnceWith(next);
  }
);

test.unit.stable(
  'retiring a toast after transport replacement leaves both notices untouched',
  async ({ render, act, expect, vi, rpcTestTransport }) => {
    const firstTransport = rpcTestTransport(async () => []).transport;
    const secondTransport = rpcTestTransport(async () => []).transport;
    const earlier = vi.fn(async () => ({}));
    const current = vi.fn(async () => ({}));

    data = [first];
    dismiss = earlier;
    apply = vi.fn(async () => ({}));
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('model-update');
    const close = vi
      .spyOn(toastManager, 'close')
      .mockImplementation(() => toast.mock.calls[0]?.[0].onClose?.());
    const view = render(<ModelUpdateNotifications transport={firstTransport} />);

    dismiss = current;
    view.rerender(<ModelUpdateNotifications transport={secondTransport} />);
    expect(close).toHaveBeenCalledWith('model-update');
    expect(earlier).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();

    await act(async () => toast.mock.calls[1]?.[0].onClose?.());
    expect(current).toHaveBeenCalledExactlyOnceWith(first);
    close.mockRestore();
  }
);

test.unit.stable(
  'reopens a failed dismissal only while its notice is current',
  async ({ render, act, expect, vi, rpcTestTransport }) => {
    const { transport } = rpcTestTransport(async () => []);
    const result = Promise.withResolvers<unknown>();

    data = [first];
    apply = vi.fn(async () => ({}));
    dismiss = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(result.promise);
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('model-update');
    const view = render(<ModelUpdateNotifications transport={transport} />);

    await act(async () => toast.mock.calls[0]?.[0].onClose?.());
    expect(toast).toHaveBeenCalledTimes(2);
    toast.mock.calls[1]?.[0].onClose?.();

    data = [next];
    view.rerender(<ModelUpdateNotifications transport={transport} />);
    await act(async () => result.reject(new Error('offline')));
    expect(toast).toHaveBeenCalledTimes(3);
    expect(toast.mock.calls[2]?.[0].description).toContain(next.model);
  }
);

test.unit.stable(
  'closing during acceptance skips dismissal and reopens a failed current offer',
  async ({ render, act, expect, vi, rpcTestTransport }) => {
    const { transport } = rpcTestTransport(async () => []);
    const result = Promise.withResolvers<unknown>();

    data = [first];
    apply = vi.fn(() => result.promise);
    dismiss = vi.fn(async () => ({}));
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('model-update');

    render(<ModelUpdateNotifications transport={transport} />);
    toast.mock.calls[0]?.[0].actionProps?.onClick?.({} as never);
    toast.mock.calls[0]?.[0].onClose?.();
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => result.reject(new Error('offline')));
    expect(toast.mock.calls.filter(([entry]) => entry.id === 'model-update')).toHaveLength(2);
    expect(toast.mock.calls.some(([entry]) => entry.type === 'error')).toBe(true);
  }
);

test.unit.stable(
  'an acceptance failure from a retired transport stays out of the new viewport',
  async ({ render, act, expect, vi, rpcTestTransport }) => {
    const earlier = rpcTestTransport(async () => []).transport;
    const current = rpcTestTransport(async () => []).transport;
    const result = Promise.withResolvers<unknown>();

    data = [first];
    apply = vi.fn(() => result.promise);
    dismiss = vi.fn(async () => ({}));
    const toast = vi.spyOn(toastManager, 'add').mockReturnValue('model-update');
    const view = render(<ModelUpdateNotifications transport={earlier} />);

    toast.mock.calls[0]?.[0].actionProps?.onClick?.({} as never);
    view.rerender(<ModelUpdateNotifications transport={current} />);
    await act(async () => result.reject(new Error('retired')));
    expect(toast.mock.calls.some(([entry]) => entry.type === 'error')).toBe(false);
  }
);
