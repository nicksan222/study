import { noteIdSchema, pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { test } from '@study/testing';

import { attachPageToNote } from './page-context.queries';

const api = test.hoisted(() => ({
  attach: test.vi.fn(),
  selection: test.vi.fn(),
  update: test.vi.fn()
}));

const input = {
  pageId: pageIdSchema.make(4n),
  versionId: pageVersionIdSchema.make(8n),
  noteId: noteIdSchema.make(2n)
};

const target = {
  input: { kind: 'page', versionId: input.versionId },
  scope: { kind: 'document' }
};

test.beforeEach(() => {
  test.vi.resetAllMocks();
  api.attach.mockResolvedValue(undefined);
  api.update.mockResolvedValue({ revision: 13n, targets: [] });
  const harness = test.rpcHandlersTransport({
    'pages.attach': api.attach,
    'notes.noteSelection': api.selection,
    'notes.updateNoteSelection': api.update
  });

  configureRpcTransport(harness.transport);
});

test.stable(
  'adds the exact document version using the current selection revision while preserving other context',
  async () => {
    const existing = {
      input: { kind: 'page', versionId: pageVersionIdSchema.make(7n) },
      scope: { kind: 'document' }
    };

    api.selection.mockResolvedValue({ revision: 12n, targets: [existing] });
    await attachPageToNote(input);
    test.expect(api.attach).toHaveBeenCalledExactlyOnceWith({
      pageId: input.pageId,
      noteId: input.noteId
    });
    test.expect(api.update).toHaveBeenCalledExactlyOnceWith({
      noteId: input.noteId,
      expectedRevision: 12n,
      targets: [existing, target]
    });
  }
);

test.stable('does not duplicate already selected document context when retried', async () => {
  api.selection.mockResolvedValue({ revision: 13n, targets: [target] });
  await attachPageToNote(input);
  test.expect(api.update).not.toHaveBeenCalled();
});

test.stable('does not continue after attachment fails', async () => {
  api.attach.mockRejectedValue(new Error('Unavailable'));
  await test.expect(attachPageToNote(input)).rejects.toMatchObject({ message: 'Unavailable' });
  test.expect(api.selection).not.toHaveBeenCalled();
  test.expect(api.update).not.toHaveBeenCalled();
});
