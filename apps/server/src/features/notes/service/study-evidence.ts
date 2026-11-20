/** @file Reads the authored text of an exact, retained notebook capture for study. */
import { blockIdSchema, createBlock, StudyError } from '@study/contracts';
import type { ContentInput, NoteId, ProjectId } from '@study/contracts';
import { transaction } from '@study/server';
import type { Transaction } from '@study/server';

import { NoteContextStore } from '#server/features/notes/store/context';
import { NoteStore } from '#server/features/notes/store/index';

import { readCapturedContext } from './context.ts';

export function captureStudyEvidence({
  noteId,
  projectId
}: {
  noteId: NoteId;
  projectId: ProjectId;
}) {
  return transaction((tx) => {
    const contextId = crypto.randomUUID();

    const note = tx.store(NoteStore).note(noteId);

    if (!note.projectIds.includes(projectId))
      throw new StudyError('invalid_input', 'Select a whole notebook in the requested subject');

    const snapshot = tx.store(NoteContextStore).capture({
      noteId,
      requestId: contextId,
      intentKey: `study-evidence/${contextId}`,
      authoredOnly: true,
      instruction: '',
      preferences: { language: 'english' },
      inputs: []
    });
    const input = { kind: 'note' as const, contextId };

    if (!snapshot.messages.length)
      throw new StudyError('invalid_input', 'The notebook has no authored text');

    return input;
  });
}

export function studyContext(
  tx: Transaction,
  input: Extract<ContentInput, { kind: 'note' }>,
  project?: ProjectId
) {
  const context = readCapturedContext(tx, input.contextId);
  const note = tx.store(NoteStore).note(context.noteId);

  if (
    context.intentKey !== `study-evidence/${input.contextId}` ||
    context.additionalNoteIds ||
    context.threadRoot !== undefined ||
    context.throughMessageId !== undefined ||
    (project !== undefined && !note.projectIds.includes(project))
  )
    throw new StudyError('invalid_input', 'Select a whole notebook in the requested subject');

  return {
    note,
    messages: context.messages.filter((message) => message.role === 'user' && message.text.trim())
  };
}

export function readStudyEvidence(
  tx: Transaction,
  input: Extract<ContentInput, { kind: 'note' }>,
  project?: ProjectId
) {
  const { note, messages } = studyContext(tx, input, project);
  const blocks = messages.map((message) =>
    createBlock(
      { type: 'paragraph', inlines: [{ type: 'text', text: message.text, marks: [] }] },
      { type: 'authored' },
      blockIdSchema.make(`note:${message.versionId}`)
    )
  );

  return {
    input,
    snapshotId: null,
    name: note.title,
    document: {
      blocks,
      meta: {
        extractor: null,
        extractorVersion: 1,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false,
        omissions: []
      }
    }
  };
}
