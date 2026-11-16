/** @file Owns library within this feature. */

import type {
  createNoteInputSchema,
  createUntitledNoteInputSchema,
  notePageInputSchema,
  noteWorkInputSchema,
  renameNoteInputSchema,
  setNoteSettledInputSchema
} from '@study/contracts';
import { text } from '@study/localization';
import { Effect } from 'effect';

import { NoteModeStore } from '#server/features/notes/store/assistant';
import { NoteStore } from '#server/features/notes/store/index';
import { NoteSummaryStore } from '#server/features/notes/store/sidebar-summary';
import { NoteWorkStore } from '#server/features/notes/store/work';
import { Settings } from '#server/features/settings/index';
import { Workflows } from '#server/features/workflows/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { requireAvailableNote } from './availability.ts';
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
          const message = postMessage(tx, {
            ...input.initialMessage,
            noteId: note.id,
            requestReply: false
          });

          if (preferences.textConversionMode === 'automatic')
            scheduleAutomaticConversion(tx, message, preferences.textConversionStrategy);

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
    setNoteSettled: (input: typeof setNoteSettledInputSchema.Type) =>
      transaction((tx) => tx.store(NoteSummaryStore).setNoteSettled(input)),
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
