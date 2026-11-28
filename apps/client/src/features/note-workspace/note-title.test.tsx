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

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./note-title');

  NoteTitleEdit = __mockModule0.NoteTitleEdit;
});

test.unit.beforeEach(({ vi }) => vi.resetAllMocks());

function mount({
  rpcTestTransport,
  render
}: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>) {
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
}

test.unit.stable(
  'saves a trimmed title for the exact note and refreshes navigation',
  async ({ screen, expect, fireEvent, waitFor, rpcTestTransport, render }) => {
    api.rename.mockResolvedValue({ id, title: 'Cell division' });
    mount({ rpcTestTransport, render });
    const input = screen.getByRole('textbox', { name: 'NoteName' });

    expect(input).toHaveValue('Biology');
    fireEvent.change(input, { target: { value: '  Cell division  ' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(api.rename).toHaveBeenCalledExactlyOnceWith({ id, title: 'Cell division' })
    );
  }
);

test.unit.stable(
  'keeps a failed rename available to retry and rejects an empty title',
  async ({ screen, fireEvent, expect, rpcTestTransport, render }) => {
    api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
    mount({ rpcTestTransport, render });
    const input = screen.getByRole('textbox', { name: 'NoteName' });

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('Biology');
    expect(api.rename).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'My title' } });
    fireEvent.blur(input);
    await screen.findByText('NoteRequestError');
    expect(input).toHaveValue('My title');
    expect(input).not.toHaveAttribute('readonly');
  }
);
