import { noteIdSchema, pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { test } from '@study/testing';

import type * as __MockType0 from './page-context.queries';

let attachPageToNote: typeof __MockType0.attachPageToNote;

let api: ReturnType<typeof createMockState>['api'];

const input = {
  pageId: pageIdSchema.make(4n),
  versionId: pageVersionIdSchema.make(8n),
  noteId: noteIdSchema.make(2n)
};

const target = {
  input: { kind: 'page', versionId: input.versionId },
  scope: { kind: 'document' }
};

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      attach: mock.fn(),
      selection: mock.fn(),
      update: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  const __mockModule0 = await import('./page-context.queries');

  attachPageToNote = __mockModule0.attachPageToNote;
});

test.beforeEach(({ vi, rpcHandlersTransport }) => {
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

test.stable(
  'adds the exact document version using the current selection revision while preserving other context',
  async ({ expect }) => {
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

test.stable(
  'does not duplicate already selected document context when retried',
  async ({ expect }) => {
    api.selection.mockResolvedValue({ revision: 13n, targets: [target] });
    await attachPageToNote(input);
    expect(api.update).not.toHaveBeenCalled();
  }
);

test.stable('does not continue after attachment fails', async ({ expect }) => {
  api.attach.mockRejectedValue(new Error('Unavailable'));
  await expect(attachPageToNote(input)).rejects.toMatchObject({ message: 'Unavailable' });
  expect(api.selection).not.toHaveBeenCalled();
  expect(api.update).not.toHaveBeenCalled();
});
