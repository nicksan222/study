/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates Assistant chats, idempotent creation and context usage.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps Assistant note state typed and durably persisted.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private stores own SQLite; public feature services coordinate behavior.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { NoteId } from '@study/contracts/ids';
import { assistantContextBudget } from '@study/contracts/notes/assistant';
import type {
  assistantChatStartSchema,
  assistantChatsInputSchema,
  assistantMemorySchema,
  assistantToolIntentSchema,
  assistantToolResultSchema,
  assistantNoteInputSchema
} from '@study/contracts/notes/assistant';
import { NoteMode } from '@study/contracts/notes/schemas';
import { text } from '@study/localization';
import { Effect, Option } from 'effect';

import {
  AssistantNoteStore,
  NoteAssistantStore,
  AssistantScopeStore,
  NoteModeStore
} from '#server/features/notes/store/assistant';
import {
  AssistantChatStartStore,
  AssistantChatsStore,
  AssistantCompactionStore,
  AssistantStateStore
} from '#server/features/notes/store/assistant-state';
import { AssistantToolStore } from '#server/features/notes/store/assistant-tools';
import { NoteStore } from '#server/features/notes/store/index';
import {
  transaction,
  publicationTransaction,
  useStore
} from '#server/platform/definitions/define-store';

export const makeAssistantNotes = Effect.gen(function* () {
  const scopes = yield* useStore(AssistantScopeStore);
  const states = yield* useStore(AssistantStateStore);
  const compaction = yield* useStore(AssistantCompactionStore);
  const assistantNote = (input: typeof assistantNoteInputSchema.Type = {}) =>
    transaction((tx) => {
      if (input.id !== undefined) {
        if (tx.store(NoteModeStore).noteMode(input.id) !== NoteMode.Assistant)
          throw new StudyError('invalid_input', 'Assistant chat required');

        return tx.store(NoteStore).note(input.id);
      }

      const existing = tx.store(AssistantNoteStore).findAssistantNote();

      return Option.isSome(existing)
        ? tx.store(NoteStore).note(existing.value)
        : tx.store(NoteStore).createNote({
            title: text('english', 'Assistant'),
            titleSource: 'user',
            mode: NoteMode.Assistant
          });
    });

  return {
    assistantNote,
    noteAssistantScope: scopes.findAssistantScope,
    noteAssistant: ({ noteId }: { noteId: NoteId }) =>
      transaction((tx) => {
        if (tx.store(NoteModeStore).noteMode(noteId) !== NoteMode.Notebook)
          throw new StudyError('invalid_input', 'Notebook note required');

        const existing = tx.store(NoteAssistantStore).findNoteAssistant(noteId);

        if (Option.isSome(existing)) return tx.store(NoteStore).note(existing.value);

        const chat = tx.store(NoteStore).createNote({
          title: text('english', 'Assistant'),
          titleSource: 'user',
          mode: NoteMode.Assistant
        });

        tx.store(NoteAssistantStore).bind({ noteId, chatId: chat.id });

        return chat;
      }),
    retainAssistantTool: (input: typeof assistantToolIntentSchema.Type) =>
      publicationTransaction((tx) => tx.store(AssistantToolStore).intent(input)),
    completeAssistantTool: (input: typeof assistantToolResultSchema.Type) =>
      publicationTransaction((tx) => tx.store(AssistantToolStore).complete(input)),
    assistantCompactionPlan: compaction.assistantCompaction,
    newAssistantNote: (input: typeof assistantChatStartSchema.Type) =>
      transaction((tx) => {
        const prior = tx.store(AssistantChatStartStore).findAssistantChatStart(input);

        if (Option.isSome(prior)) return tx.store(NoteStore).note(prior.value);

        const note = tx.store(NoteStore).createNote({
          title: text('english', 'Assistant'),
          titleSource: 'user',
          mode: NoteMode.Assistant
        });

        tx.store(AssistantChatStartStore).retain({ ...input, noteId: note.id });

        return note;
      }),
    assistantChats: (input: typeof assistantChatsInputSchema.Type) =>
      transaction((tx) => {
        const ids = tx.store(AssistantChatsStore).assistantChats(input);
        const last = ids.at(-1);
        const more =
          last !== undefined && ids.length === input.limit
            ? tx.store(AssistantChatsStore).assistantChats({ limit: 1, before: last })
            : [];

        return {
          items: ids.map((id) => tx.store(NoteStore).note(id)),
          next: more.length ? last! : null
        };
      }),
    assistantMemory: (noteId: NoteId) =>
      states.assistantState(noteId).pipe(Effect.map((state) => state.memory)),
    saveAssistantMemory: (input: typeof assistantMemorySchema.Type) =>
      publicationTransaction((tx) => tx.store(AssistantStateStore).saveMemory(input)),
    assistantContext: ({ noteId }: { noteId: NoteId }) =>
      states.assistantState(noteId).pipe(
        Effect.map(({ memory, characters }) => ({
          estimatedTokens: Math.ceil(
            (characters + (memory?.summary.length ?? 0) + assistantContextBudget.reserve) / 4
          ),
          maxTokens: assistantContextBudget.characters / 4,
          autoCompact: true as const,
          lastCompactedAtMs: memory?.updatedAtMs ?? null
        }))
      )
  };
});
