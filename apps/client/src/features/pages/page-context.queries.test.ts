import { noteIdSchema, pageIdSchema, pageVersionIdSchema } from '@study/contracts/ids';
import { configureRpcTransport } from '@study/contracts/react';
import { testStable } from '@study/testing/vitest';
import { expect, beforeEach, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { attachPageToNote } from './page-context.queries';

const api = vi.hoisted(() => ({ attach: vi.fn(), selection: vi.fn(), update: vi.fn() }));

const input = {
  pageId: pageIdSchema.make(4n),
  versionId: pageVersionIdSchema.make(8n),
  noteId: noteIdSchema.make(2n)
};

const target = {
  input: { kind: 'page', versionId: input.versionId },
  scope: { kind: 'document' }
};

beforeEach(() => {
  vi.resetAllMocks();
  api.attach.mockResolvedValue(undefined);
  api.update.mockResolvedValue({ revision: 13n, targets: [] });
  const harness = rpcHandlersTransport({
    'pages.attach': api.attach,
    'notes.noteSelection': api.selection,
    'notes.updateNoteSelection': api.update
  });

  configureRpcTransport(harness.transport);
});

testStable(
  'adds the exact document version using the current selection revision while preserving other context',
  async () => {
    const existing = {
      input: { kind: 'page', versionId: pageVersionIdSchema.make(7n) },
      scope: { kind: 'document' }
    };

    api.selection.mockResolvedValue({ revision: 12n, targets: [existing] });
    await attachPageToNote(input);
    expect(api.attach).toHaveBeenCalledExactlyOnceWith({
      pageId: input.pageId,
      noteId: input.noteId
    });
    expect(api.update).toHaveBeenCalledExactlyOnceWith({
      noteId: input.noteId,
      expectedRevision: 12n,
      targets: [existing, target]
    });
  }
);

testStable('does not duplicate already selected document context when retried', async () => {
  api.selection.mockResolvedValue({ revision: 13n, targets: [target] });
  await attachPageToNote(input);
  expect(api.update).not.toHaveBeenCalled();
});

testStable('does not continue after attachment fails', async () => {
  api.attach.mockRejectedValue(new Error('Unavailable'));
  await expect(attachPageToNote(input)).rejects.toMatchObject({ message: 'Unavailable' });
  expect(api.selection).not.toHaveBeenCalled();
  expect(api.update).not.toHaveBeenCalled();
});
