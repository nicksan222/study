import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { NoteTitleEdit } from './note-title';

const api = test.hoisted(() => ({ rename: test.vi.fn() }));

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

test.beforeEach(() => test.vi.resetAllMocks());

function mount() {
  const fixture = test.rpcTestTransport(async (_tag, input) => {
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

  test.render(<NoteTitleEdit id={id} title="Biology" />, { wrapper: fixture.wrapper });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteRename' }));
}

test.stable('saves a trimmed title for the exact note and refreshes navigation', async () => {
  api.rename.mockResolvedValue({ id, title: 'Cell division' });
  mount();
  const input = test.screen.getByRole('textbox', { name: 'NoteName' });

  test.expect(input).toHaveValue('Biology');
  test.fireEvent.change(input, { target: { value: '  Cell division  ' } });
  test.fireEvent.submit(input.closest('form')!);
  await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument());
  test.expect(api.rename).toHaveBeenCalledExactlyOnceWith({ id, title: 'Cell division' });
});

test.stable('keeps a failed rename available to retry and rejects an empty title', async () => {
  api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
  mount();
  const input = test.screen.getByRole('textbox', { name: 'NoteName' });

  test.fireEvent.change(input, { target: { value: '   ' } });
  test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  test.fireEvent.change(input, { target: { value: 'My title' } });
  test.fireEvent.submit(input.closest('form')!);
  await test.screen.findByText('NoteRequestError');
  test.expect(input).toHaveValue('My title');
  test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test.stable('cancels without saving', async () => {
  mount();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Cancel' }));
  await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument());
  test.expect(api.rename).not.toHaveBeenCalled();
});
