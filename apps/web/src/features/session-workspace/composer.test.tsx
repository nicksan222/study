import { askResultSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { Composer } from './composer';
import type { Draft } from './draft';
import type * as SessionQueries from './session-workspace.queries';
import { ask, saveNote } from './session-workspace.queries';

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
}));
vi.mock('./session-workspace.queries', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionQueries>();

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

const preferences = vi.hoisted(() => ({ submitOnEnter: false }));

vi.mock('#web/lib/study-client/workspace-preferences.queries.ts', () => ({
  useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, ...preferences })
}));

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

testStable(
  'captures a note without chat controls and preserves later typing after its save',
  async () => {
    let resolve!: (value: Awaited<ReturnType<typeof saveNote>>) => void;

    vi.mocked(saveNote).mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        })
    );
    mount();
    expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
    expect(screen.queryByTitle('SessionGenerationPreferences')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Lecture notes' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Lecture notes', []));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Later draft' } });
    await act(async () => resolve({} as Awaited<ReturnType<typeof saveNote>>));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Later draft'));
    expect(ask).not.toHaveBeenCalled();
  }
);

testStable(
  'recovers an already stored ambiguous Ask after navigation without exposing new chat controls',
  async () => {
    vi.mocked(ask)
      .mockRejectedValueOnce(new StudyError('transient', 'Unconfirmed'))
      .mockResolvedValueOnce(receipt);
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    const submitted = {
      sessionId: id,
      intentKey: 'retained-ask',
      expectedSelectionRevision: 8n,
      text: 'Original question'
    };

    cache.setQueryData<Draft>(['session-drafts', String(id), 'note'], {
      text: 'Original question',
      instruction: '',
      askAttempt: submitted
    });
    const first = mount(cache);

    expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'SessionRetryAsk' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do not send this yet' } });
    first.unmount();
    mount(cache);
    fireEvent.click(screen.getByRole('button', { name: 'SessionRetryAsk' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(ask).mock.calls[1]![0]).toEqual(submitted);
    expect(saveNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Do not send this yet'));
  }
);

testStable('does not automatically resubmit a note whose save was not confirmed', async () => {
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

testStable('keeps plain capture available while selection edits remain unsaved', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  cache.setQueryData(['session-drafts', String(id), 'selection'], { revision: 8n, targets: [] });
  vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
  mount(cache);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quick note' } });
  expect(screen.queryByRole('button', { name: 'SessionAsk' })).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'SessionSaveNote' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'SessionSaveNote' }));
  await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, 'A quick note', []));
  expect(ask).not.toHaveBeenCalled();
});

testStable(
  'saves a note with the primary keyboard shortcut without asking for a reply',
  async () => {
    vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    mount();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Rough lecture notes' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith(id, 'Rough lecture notes', []));
    expect(ask).not.toHaveBeenCalled();
  }
);

testStable('keeps Enter and composition keystrokes in the notebook editor', () => {
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

testStable('optionally submits Enter while preserving Shift+Enter and composition', async () => {
  preferences.submitOnEnter = true;
  vi.mocked(saveNote).mockImplementation(() => new Promise(() => {}));
  mount();
  const input = screen.getByRole('textbox');

  fireEvent.change(input, { target: { value: 'Quick thought' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(saveNote).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1));
  preferences.submitOnEnter = false;
});
