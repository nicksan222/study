/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates Assistant chats, idempotent creation and context usage.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps Assistant conversation state typed and durably persisted.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private stores own SQLite; public feature services coordinate behavior.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { assistantContextBudget } from '@study/contracts/conversations/assistant';
import type {
  assistantChatStartSchema,
  assistantChatsInputSchema,
  assistantMemorySchema,
  assistantToolIntentSchema,
  assistantToolResultSchema,
  assistantSessionInputSchema
} from '@study/contracts/conversations/assistant';
import { ConversationMode } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { text } from '@study/localization';
import { Effect, Option } from 'effect';

import {
  AssistantSessionStore,
  SessionModeStore
} from '#server/features/conversations/store/assistant';
import {
  AssistantChatStartStore,
  AssistantChatsStore,
  AssistantCompactionStore,
  AssistantStateStore
} from '#server/features/conversations/store/assistant-state';
import { AssistantToolStore } from '#server/features/conversations/store/assistant-tools';
import { SessionStore } from '#server/features/conversations/store/index';
import {
  transaction,
  publicationTransaction,
  useStore
} from '#server/platform/definitions/define-store';

export const makeAssistantConversations = Effect.gen(function* () {
  const states = yield* useStore(AssistantStateStore);
  const compaction = yield* useStore(AssistantCompactionStore);
  const assistantSession = (input: typeof assistantSessionInputSchema.Type = {}) =>
    transaction((tx) => {
      if (input.id !== undefined) {
        if (tx.store(SessionModeStore).sessionMode(input.id) !== ConversationMode.Assistant)
          throw new StudyError('invalid_input', 'Assistant chat required');

        return tx.store(SessionStore).session(input.id);
      }

      const existing = tx.store(AssistantSessionStore).findAssistantSession();

      return Option.isSome(existing)
        ? tx.store(SessionStore).session(existing.value)
        : tx.store(SessionStore).createSession({
            title: text('english', 'Assistant'),
            titleSource: 'user',
            mode: ConversationMode.Assistant
          });
    });

  return {
    assistantSession,
    retainAssistantTool: (input: typeof assistantToolIntentSchema.Type) =>
      publicationTransaction((tx) => tx.store(AssistantToolStore).intent(input)),
    completeAssistantTool: (input: typeof assistantToolResultSchema.Type) =>
      publicationTransaction((tx) => tx.store(AssistantToolStore).complete(input)),
    assistantCompactionPlan: compaction.assistantCompaction,
    newAssistantSession: (input: typeof assistantChatStartSchema.Type) =>
      transaction((tx) => {
        const prior = tx.store(AssistantChatStartStore).findAssistantChatStart(input);

        if (Option.isSome(prior)) return tx.store(SessionStore).session(prior.value);

        const session = tx.store(SessionStore).createSession({
          title: text('english', 'Assistant'),
          titleSource: 'user',
          mode: ConversationMode.Assistant
        });

        tx.store(AssistantChatStartStore).retain({ ...input, sessionId: session.id });

        return session;
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
          items: ids.map((id) => tx.store(SessionStore).session(id)),
          next: more.length ? last! : null
        };
      }),
    assistantMemory: (sessionId: SessionId) =>
      states.assistantState(sessionId).pipe(Effect.map((state) => state.memory)),
    saveAssistantMemory: (input: typeof assistantMemorySchema.Type) =>
      publicationTransaction((tx) => tx.store(AssistantStateStore).saveMemory(input)),
    assistantContext: ({ sessionId }: { sessionId: SessionId }) =>
      states.assistantState(sessionId).pipe(
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
