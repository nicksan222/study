/** @file Owns library within this feature. */

import { StudyError } from '@study/contracts';
import type {
  createNoteInputSchema,
  createUntitledNoteInputSchema,
  notePageInputSchema,
  noteWorkInputSchema,
  renameNoteInputSchema
} from '@study/contracts';
import { text } from '@study/localization';
import { transaction, useStore } from '@study/server';
import { Effect } from 'effect';

import { NoteModeStore } from '#server/features/notes/store/assistant';
import { NoteStore } from '#server/features/notes/store/index';
import { NoteSummaryStore } from '#server/features/notes/store/sidebar-summary';
import { NoteWorkStore } from '#server/features/notes/store/work';
import { Settings } from '#server/features/settings/index';
import { Workflows } from '#server/features/workflows/index';

import { requireAvailableNote } from './availability.ts';
import { saveBodyInTransaction } from './body.ts';
import { ensureNote, notebookNote } from './ensure-note.ts';
import { scheduleAutomaticTitle } from './generation-events.ts';
import { mergeNotes } from './merge.ts';
import { postMessage } from './messages.ts';
import { readWorkspacePreferences } from './preferences.ts';
import { scheduleAutomaticConversion } from './request-targets.ts';

export function* noteLibraryOperations() {
  const store = yield* useStore(NoteStore);

  const modes = yield* useStore(NoteModeStore);
  const summaries = yield* useStore(NoteSummaryStore);

  return {
    noteMode: modes.noteMode,
    mergeNotes,
    createUntitledNote: Effect.fnUntraced(function* (
      input: typeof createUntitledNoteInputSchema.Type
    ) {
      const settings = yield* Settings;
      const language = yield* settings.language();
      const preferences = yield* readWorkspacePreferences();

      return yield* transaction((tx) => {
        const note = tx.store(NoteStore).createNote({
          project: input.project,
          title: text(language, 'NewNote'),
          titleSource: 'provisional'
        });

        if (input.initialMessage) {
          const { notebookBody, sourceIds, text } = input.initialMessage;

          if (notebookBody) {
            if (!text.trim() || sourceIds?.length)
              throw new StudyError('invalid_input', 'An initial notebook body requires text only');

            saveBodyInTransaction(tx, { noteId: note.id, text, expectedVersionId: null });
          } else {
            const message = postMessage(tx, {
              noteId: note.id,
              text,
              sourceIds,
              requestReply: false
            });

            if (preferences.textConversionMode === 'automatic')
              scheduleAutomaticConversion(tx, message, preferences.textConversionStrategy);
          }

          if (preferences.autoTitleNotes) scheduleAutomaticTitle(tx, note.id);
        }

        return note;
      });
    }),
    ensureNote,
    notebookNote,
    renameNote: (input: typeof renameNoteInputSchema.Type) =>
      transaction((tx) => tx.store(NoteStore).renameNote(input)),
    noteWork: (input: typeof noteWorkInputSchema.Type) =>
      transaction((tx) => {
        requireAvailableNote(tx, input.noteId);

        const rows = tx.store(NoteWorkStore).noteWorkItems(input);
        const items = rows.map(({ executionId, createdAtMs: _, ...item }) => ({
          ...item,
          execution: Workflows.executionInTransaction(tx, executionId)
        }));
        const last = items.at(-1)?.execution;
        const cursor = last ? { id: last.id, createdAtMs: last.createdAtMs } : null;
        const more =
          cursor && rows.length === input.limit
            ? tx.store(NoteWorkStore).noteWorkItems({ ...input, before: cursor, limit: 1 })
            : [];

        return { items, next: more.length ? cursor : null };
      }),
    noteSummaries: summaries.noteSummary,
    count: store.count,
    note: store.note,
    findNote: store.findNote,
    notes: Effect.fnUntraced(function* (input: typeof notePageInputSchema.Type) {
      const items = yield* store.notes(input);

      const last = items.at(-1);

      const more =
        last && items.length === input.limit
          ? yield* store.notes({
              project: input.project,
              limit: 1,
              before: { updatedAt: last.updatedAt, id: last.id }
            })
          : [];

      return {
        items,
        next: more.length && last ? { updatedAt: last.updatedAt, id: last.id } : null
      };
    }),
    createNote: (input: typeof createNoteInputSchema.Type) =>
      transaction((tx) => tx.store(NoteStore).createNote({ ...input, titleSource: 'user' }))
  };
}
