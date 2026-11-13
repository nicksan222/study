import { chatMessageSchema } from '@study/contracts/notes/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { request } from '#client/lib/study-client/request.ts';

import { MessageDeletion } from './message-deletion';

vi.mock('#client/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const en = catalogs.english;

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 41n,
  noteId: 7n,
  role: 'user',
  format: 'text',
  description: null,
  threadRoot: null,
  replyTo: null,
  activeVersionId: 43n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  captureKey: null,
  createdAt: 1n,
  versions: [42n, 43n].map((id, index) => ({
    id,
    number: BigInt(index + 1),
    origin: 'typed',
    status: 'complete',
    text: 'Note ' + id,
    basedOn: null,
    instruction: null,
    createdAt: 1n
  })),
  parts: [],
  citations: []
});

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MessageDeletion message={message} versionId={message.versions[0]!.id} />
    </QueryClientProvider>
  );
}

testStable('confirms only the displayed revision and keeps item deletion separate', async () => {
  const removeVersion = vi.fn().mockResolvedValue({ ...message, versions: [message.versions[1]!] });
  const removeItem = vi.fn().mockResolvedValue(true);

  vi.mocked(request).mockImplementation(async (invoke) =>
    invoke({
      'notes.deleteMessageVersion': removeVersion,
      'notes.deleteMessage': removeItem
    } as never)
  );
  mount();
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: en.NoteDeleteVersion }));
  const dialog = await screen.findByRole('alertdialog');

  expect(removeVersion).not.toHaveBeenCalled();
  expect(within(dialog).getByText(en.NoteDeleteVersionHelp)).toBeVisible();
  await user.type(within(dialog).getByRole('textbox'), en.DeleteConfirmationWord);
  await user.click(within(dialog).getByRole('button', { name: en.NoteDeleteVersion }));
  await waitFor(() =>
    expect(removeVersion).toHaveBeenCalledExactlyOnceWith({
      messageId: message.id,
      versionId: message.versions[0]!.id
    })
  );
  expect(removeItem).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: en.NoteDeleteItem }));
  const entire = await screen.findByRole('alertdialog');

  expect(within(entire).getByText(en.NoteDeleteItemHelp)).toBeVisible();
  await user.click(within(entire).getByRole('button', { name: en.Cancel }));
  expect(removeItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: en.NoteDeleteItem }));
  const confirmed = await screen.findByRole('alertdialog');

  await user.type(within(confirmed).getByRole('textbox'), en.DeleteConfirmationWord);
  await user.click(within(confirmed).getByRole('button', { name: en.NoteDeleteItem }));
  await waitFor(() => expect(removeItem).toHaveBeenCalledExactlyOnceWith({ id: message.id }));
  expect(removeVersion).toHaveBeenCalledOnce();
});
