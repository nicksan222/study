import { StudyError, noteIdSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { NoteTitleEdit } from './note-title';

const api = vi.hoisted(() => ({ rename: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const id = Schema.decodeUnknownSync(noteIdSchema)(9007199254740993n);

beforeEach(() => vi.resetAllMocks());

function mount() {
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

testStable('saves a trimmed title for the exact note and refreshes navigation', async () => {
  api.rename.mockResolvedValue({ id, title: 'Cell division' });
  mount();
  const input = screen.getByRole('textbox', { name: 'NoteName' });

  expect(input).toHaveValue('Biology');
  fireEvent.change(input, { target: { value: '  Cell division  ' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.rename).toHaveBeenCalledExactlyOnceWith({ id, title: 'Cell division' });
});

testStable('keeps a failed rename available to retry and rejects an empty title', async () => {
  api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
  mount();
  const input = screen.getByRole('textbox', { name: 'NoteName' });

  fireEvent.change(input, { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'My title' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByText('NoteRequestError');
  expect(input).toHaveValue('My title');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

testStable('cancels without saving', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.rename).not.toHaveBeenCalled();
});
