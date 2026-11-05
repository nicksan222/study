import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { Transformation } from './transformation';

const api = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'conversations.suggestTransformField': api.suggest,
      'conversations.sessionSelection': async () => ({ revision: 1n, targets: [] }),
      'conversations.session': async () => ({ updatedAt: 1n }),
      'conversations.sessionGenerations': async () => ({ items: [], next: null })
    })
}));
vi.mock('./history', () => ({ CapturedContext: () => null }));

const id = sessionIdSchema.make(1n);
let cache: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  cache.clear();
});

function mount(active = true) {
  return render(
    <QueryClientProvider client={cache}>
      <Transformation id={id} active={active} />
    </QueryClientProvider>
  );
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

testStable('generates each field independently and preserves edits during generation', async () => {
  const title = deferred();
  api.suggest.mockImplementation(({ field }: { field: string }) =>
    field === 'title' ? title.promise : Promise.resolve('Explain cell division')
  );
  mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateTitle' }));
  await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'SessionGenerateTitle' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateInstructions' }));
  await waitFor(() =>
    expect(screen.getByLabelText('SessionInstructions')).toHaveValue('Explain cell division')
  );
  fireEvent.change(screen.getByLabelText('SessionOutputTitle'), { target: { value: 'My title' } });
  await waitFor(() => expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('My title'));
  await act(async () => title.resolve('Generated title'));
  expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('My title');
  expect(api.suggest).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: id, field: 'instruction', language: 'english' })
  );
});

testStable('ignores old results after dismiss and reopen even when kept mounted', async () => {
  const title = deferred();
  api.suggest.mockReturnValue(title.promise);
  const view = mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateTitle' }));
  await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
  view.rerender(
    <QueryClientProvider client={cache}>
      <Transformation id={id} active={false} />
    </QueryClientProvider>
  );
  view.rerender(
    <QueryClientProvider client={cache}>
      <Transformation id={id} active />
    </QueryClientProvider>
  );
  await act(async () => title.resolve('Old title'));
  expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('');
});

testStable('shows a field error without clearing the other field and allows retry', async () => {
  api.suggest
    .mockRejectedValueOnce(new StudyError('auth', 'Sign in'))
    .mockResolvedValue('Cell biology');
  mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateTitle' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('SessionInstructions')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateTitle' }));
  await waitFor(() =>
    expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('Cell biology')
  );
});

testStable(
  'ignores results after saved context changes or the selected sessions change',
  async () => {
    const title = deferred();
    api.suggest.mockReturnValue(title.promise);
    const view = mount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionGenerateTitle' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateTitle' }));
    await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
    act(() =>
      cache.setQueryData(['session-workspace', '1', 'selection'], { revision: 2n, targets: [] })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionGenerateTitle' })).toBeEnabled()
    );
    await act(async () => title.resolve('Stale title'));
    expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('');
    const next = deferred();
    api.suggest.mockReturnValue(next.promise);
    fireEvent.click(screen.getByRole('button', { name: 'SessionGenerateTitle' }));
    await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(2));
    view.rerender(
      <QueryClientProvider client={cache}>
        <Transformation
          id={id}
          sessions={[
            { id, title: 'First' },
            { id: sessionIdSchema.make(2n), title: 'Second' }
          ]}
        />
      </QueryClientProvider>
    );
    await act(async () => next.resolve('Wrong group'));
    expect(screen.getByLabelText('SessionOutputTitle')).toHaveValue('');
  }
);
