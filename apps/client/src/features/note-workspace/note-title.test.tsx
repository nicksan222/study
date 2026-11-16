import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './note-title';

let NoteTitleEdit: typeof __MockType0.NoteTitleEdit;

let api: ReturnType<typeof createMockState>['api'];

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ rename: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./note-title');

  NoteTitleEdit = __mockModule0.NoteTitleEdit;
});

test.beforeEach(({ vi }) => vi.resetAllMocks());

function mount({
  rpcTestTransport,
  render,
  fireEvent,
  screen
}: Pick<test.Context, 'rpcTestTransport' | 'render' | 'fireEvent' | 'screen'>) {
  const fixture = rpcTestTransport(async (_tag, input) => {
    const renamed = await api.rename(input);

    return {
      titleSource: 'user',
      projectIds: [],
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 2n,
      ...renamed
    };
  });

  render(<NoteTitleEdit id={id} title="Biology" />, { wrapper: fixture.wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'NoteRename' }));
}

test.stable(
  'saves a trimmed title for the exact note and refreshes navigation',
  async ({ screen, expect, fireEvent, waitFor, rpcTestTransport, render }) => {
    api.rename.mockResolvedValue({ id, title: 'Cell division' });
    mount({ rpcTestTransport, render, fireEvent, screen });
    const input = screen.getByRole('textbox', { name: 'NoteName' });

    expect(input).toHaveValue('Biology');
    fireEvent.change(input, { target: { value: '  Cell division  ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.rename).toHaveBeenCalledExactlyOnceWith({ id, title: 'Cell division' });
  }
);

test.stable(
  'keeps a failed rename available to retry and rejects an empty title',
  async ({ screen, fireEvent, expect, rpcTestTransport, render }) => {
    api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
    mount({ rpcTestTransport, render, fireEvent, screen });
    const input = screen.getByRole('textbox', { name: 'NoteName' });

    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'My title' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText('NoteRequestError');
    expect(input).toHaveValue('My title');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  }
);

test.stable(
  'cancels without saving',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render, fireEvent, screen });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.rename).not.toHaveBeenCalled();
  }
);
