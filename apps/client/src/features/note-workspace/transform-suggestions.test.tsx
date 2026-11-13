import { StudyError } from '@study/contracts/errors';
import { noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { Transformation } from './transformation';

const api = vi.hoisted(() => ({ suggest: vi.fn(), readiness: 'ready' as string }));

vi.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => api.readiness }));
vi.mock('#client/lib/ai-readiness-notice.tsx', () => ({
  AiReadinessNotice: ({ state }: { state: string }) =>
    state === 'ready' ? null : <p>Readiness: {state}</p>
}));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));
vi.mock('#client/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'notes.suggestTransformField': api.suggest,
      'notes.noteSelection': async () => ({ revision: 1n, targets: [] }),
      'notes.note': async () => ({ updatedAt: 1n }),
      'notes.noteGenerations': async () => ({ items: [], next: null })
    })
}));
vi.mock('./history', () => ({ CapturedContext: () => null }));

const id = noteIdSchema.make(1n);

let cache: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  api.readiness = 'ready';
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
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateInstructions' }));
  await waitFor(() =>
    expect(screen.getByLabelText('NoteInstructions')).toHaveValue('Explain cell division')
  );
  fireEvent.change(screen.getByLabelText('NoteOutputTitle'), { target: { value: 'My title' } });
  await waitFor(() => expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('My title'));
  await act(async () => title.resolve('Generated title'));
  expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('My title');
  expect(api.suggest).toHaveBeenCalledWith(
    expect.objectContaining({ noteId: id, field: 'instruction', language: 'english' })
  );
});

testStable('ignores old results after dismiss and reopen even when kept mounted', async () => {
  const title = deferred();

  api.suggest.mockReturnValue(title.promise);
  const view = mount();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
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
  expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
});

testStable('shows a field error without clearing the other field and allows retry', async () => {
  api.suggest
    .mockRejectedValueOnce(new StudyError('auth', 'Sign in'))
    .mockResolvedValue('Cell biology');
  mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('NoteInstructions')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await waitFor(() => expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('Cell biology'));
});

testStable('ignores results after saved context changes or the selected notes change', async () => {
  const title = deferred();

  api.suggest.mockReturnValue(title.promise);
  const view = mount();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(1));
  act(() =>
    cache.setQueryData(['note-workspace', '1', 'selection'], { revision: 2n, targets: [] })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  await act(async () => title.resolve('Stale title'));
  expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
  const next = deferred();

  api.suggest.mockReturnValue(next.promise);
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  await waitFor(() => expect(api.suggest).toHaveBeenCalledTimes(2));
  view.rerender(
    <QueryClientProvider client={cache}>
      <Transformation
        id={id}
        notes={[
          { id, title: 'First' },
          { id: noteIdSchema.make(2n), title: 'Second' }
        ]}
      />
    </QueryClientProvider>
  );
  await act(async () => next.resolve('Wrong group'));
  expect(screen.getByLabelText('NoteOutputTitle')).toHaveValue('');
});

testStable('disables suggestions above twenty notes without truncating the selection', () => {
  render(
    <QueryClientProvider client={cache}>
      <Transformation
        id={id}
        notes={Array.from({ length: 21 }, (_, index) => ({
          id: noteIdSchema.make(BigInt(index + 1)),
          title: `Note ${index + 1}`
        }))}
      />
    </QueryClientProvider>
  );
  expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'NoteGenerateInstructions' })).toBeDisabled();
  expect(screen.getAllByText('NoteSuggestionLimit')).toHaveLength(2);
  expect(api.suggest).not.toHaveBeenCalled();
});

testStable('offers retry guidance for invalid model output', async () => {
  api.suggest.mockRejectedValue(new StudyError('transient', 'Invalid transform suggestion'));
  mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'NoteGenerateTitle' }));
  expect(await screen.findByText('NoteSuggestionError')).toBeVisible();
  expect(screen.queryByText('NoteSuggestionContextError')).toBeNull();
});

testStable('blocks new suggestions and page creation when setup is missing', async () => {
  api.readiness = 'setup';
  mount();
  expect(screen.getAllByText('Readiness: setup')).toHaveLength(1);
  await waitFor(() => expect(screen.getByLabelText('NoteOutputTitle')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('NoteOutputTitle'), { target: { value: 'Title' } });
  expect(screen.getByRole('button', { name: 'NoteGenerateTitle' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'NoteCreatePage' })).toBeDisabled();
  expect(api.suggest).not.toHaveBeenCalled();
});
