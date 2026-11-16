import { chatMessageSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { MessageDeletion } from './message-deletion';

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

let fixture: ReturnType<typeof test.rpcHandlersTransport>;

test.afterEach(() => {
  test.cleanup();
  test.vi.clearAllMocks();
});

function mount() {
  test.render(<MessageDeletion message={message} versionId={message.versions[0]!.id} />, {
    wrapper: fixture.wrapper
  });
}

test.stable('confirms only the displayed revision and keeps item deletion separate', async () => {
  const removeVersion = test.vi
    .fn()
    .mockResolvedValue({ ...message, versions: [message.versions[1]!] });
  const removeItem = test.vi.fn().mockResolvedValue(true);

  fixture = test.rpcHandlersTransport({
    'notes.deleteMessageVersion': removeVersion,
    'notes.deleteMessage': removeItem
  });
  mount();
  const user = test.userEvent.setup();

  await user.click(test.screen.getByRole('button', { name: en.NoteDeleteVersion }));
  const dialog = await test.screen.findByRole('alertdialog');

  test.expect(removeVersion).not.toHaveBeenCalled();
  test.expect(test.within(dialog).getByText(en.NoteDeleteVersionHelp)).toBeVisible();
  await user.type(test.within(dialog).getByRole('textbox'), en.DeleteConfirmationWord);
  await user.click(test.within(dialog).getByRole('button', { name: en.NoteDeleteVersion }));
  await test.waitFor(() =>
    test.expect(removeVersion).toHaveBeenCalledExactlyOnceWith({
      messageId: message.id,
      versionId: message.versions[0]!.id
    })
  );
  test.expect(removeItem).not.toHaveBeenCalled();
  await test.waitFor(() =>
    test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  );
  await user.click(test.screen.getByRole('button', { name: en.NoteDeleteItem }));
  const entire = await test.screen.findByRole('alertdialog');

  test.expect(test.within(entire).getByText(en.NoteDeleteItemHelp)).toBeVisible();
  await user.click(test.within(entire).getByRole('button', { name: en.Cancel }));
  test.expect(removeItem).not.toHaveBeenCalled();
  await user.click(test.screen.getByRole('button', { name: en.NoteDeleteItem }));
  const confirmed = await test.screen.findByRole('alertdialog');

  await user.type(test.within(confirmed).getByRole('textbox'), en.DeleteConfirmationWord);
  await user.click(test.within(confirmed).getByRole('button', { name: en.NoteDeleteItem }));
  await test.waitFor(() =>
    test.expect(removeItem).toHaveBeenCalledExactlyOnceWith({ id: message.id })
  );
  test.expect(removeVersion).toHaveBeenCalledOnce();
});
