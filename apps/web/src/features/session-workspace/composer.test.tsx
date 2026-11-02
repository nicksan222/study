import { askResultSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { Composer } from './composer';
import { ask, saveNote } from './session-workspace.queries';

vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
}));
vi.mock('./session-workspace.queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-workspace.queries')>();
  return {
    ...actual,
    ask: vi.fn(),
    saveNote: vi.fn(),
    selectionOptions: () => ({
      queryKey: ['test-selection'],
      queryFn: async () => ({ revision: 8n, targets: [] })
    })
  };
});
const id = Schema.decodeUnknownSync(sessionIdSchema)(9007199254740993n);
const receipt = Schema.decodeUnknownSync(askResultSchema)({
  sessionId: id,
  requestId: 'request-exact',
  messageId: 3n,
  versionId: 4n,
  userMessageId: 1n,
  userVersionId: 2n
});
beforeEach(() => vi.clearAllMocks());
function mount(
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) {
  return {
    cache,
    ...render(
      <QueryClientProvider client={cache}>
        <Composer id={id} />
      </QueryClientProvider>
    )
  };
}
it('uses one atomic Ask call and keeps later unsent typing after the receipt', async () => {
  let resolve!: (value: typeof receipt) => void;
  vi.mocked(ask).mockImplementation(
    () =>
      new Promise((accept) => {
        resolve = accept;
      })
  );
  mount();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Question about this selection' }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'SessionAsk' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'SessionAsk' }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: id,
      expectedSelectionRevision: 8n,
      text: 'Question about this selection',
      preferences: { language: 'italian' }
    })
  );
  expect(saveNote).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Later draft' } });
  await act(async () => resolve(receipt));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Later draft'));
});
it('recovers an ambiguous Ask after navigation using its original payload and intent key', async () => {
  vi.mocked(ask)
    .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed'))
    .mockResolvedValueOnce(receipt);
  const first = mount();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original question' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'SessionAsk' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'SessionAsk' }));
  await screen.findByRole('alert');
  const submitted = vi.mocked(ask).mock.calls[0]![0];
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do not send this yet' } });
  first.unmount();
  mount(first.cache);
  expect(screen.getByRole('textbox')).toHaveValue('Do not send this yet');
  fireEvent.click(screen.getByRole('button', { name: 'SessionRetryAsk' }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  expect(vi.mocked(ask).mock.calls[1]![0]).toEqual(submitted);
  expect(saveNote).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Do not send this yet'));
});
it('does not automatically resubmit a note whose save was not confirmed', async () => {
  vi.mocked(saveNote).mockRejectedValue(new StudyError('transient', 'Unconfirmed'));
  mount();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this note' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await screen.findByText('SessionNoteUncertain');
  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('Keep this note');
  expect(ask).not.toHaveBeenCalled();
});
it('blocks Ask while exact selection edits remain unsaved', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(['session-drafts', String(id), 'selection'], { revision: 8n, targets: [] });
  mount(cache);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Question' } });
  expect(screen.getByRole('button', { name: 'SessionAsk' })).toBeDisabled();
  expect(ask).not.toHaveBeenCalled();
});

it('saves a note with the primary keyboard shortcut without asking for a reply', async () => {
  vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
  mount();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Rough lecture notes' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, 'Rough lecture notes', []));
  expect(ask).not.toHaveBeenCalled();
});
it('keeps Enter and composition keystrokes in the notebook editor', () => {
  mount();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First line' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('textbox'), {
    key: 'Enter',
    ctrlKey: true,
    isComposing: true
  });
  expect(saveNote).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
});
