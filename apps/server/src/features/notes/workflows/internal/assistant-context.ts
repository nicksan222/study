/** @file Owns assistant context within this feature. */

import type { replySnapshotSchema, versionIdSchema } from '@study/contracts';
import {
  NoteMode,
  StudyError,
  assistantContextBudget,
  assistantMemorySchema
} from '@study/contracts';
import type { Context } from 'effect';
import { Clock, Effect, Option, Schema } from 'effect';

import { compactAssistantAgent } from '#server/features/notes/agents/assistant-compaction';
import { Notes } from '#server/features/notes/service/index';
import { generateAgent } from '#server/platform/ai/agents';
import { Database } from '#server/platform/database/database';
import { resumableActivity } from '#server/platform/definitions/define-activity';
import type { AgentEnvironment } from '#server/platform/definitions/define-agent';
import { impactToken } from '#server/platform/definitions/impact-token';
import { withPublicationGuard } from '#server/platform/workflows/publication';

/** The checkpoint retains memory across provider retries without changing visible history. */
export function prepareAssistantContext(requestId: string) {
  return resumableActivity({
    name: 'prepare-assistant-context',
    success: Schema.NullOr(assistantMemorySchema),

    execute: function* () {
      const notes = yield* Notes;
      const snapshot = yield* notes.replySnapshot({ requestId });

      if ((yield* notes.noteMode(snapshot.noteId)) !== NoteMode.Assistant) return null;

      const throughMessageId = snapshot.messages.at(-1)?.messageId;

      if (throughMessageId === undefined) return null;

      const latestMemory = yield* notes.assistantMemory(snapshot.noteId);

      if (memoryAfterQuestion(latestMemory, throughMessageId)) return null;

      const database = yield* Database;
      let plan = yield* notes.assistantCompactionPlan({
        noteId: snapshot.noteId,
        throughMessageId
      });

      if (!needsCompaction(plan)) return plan.memory;

      while (plan.characters > assistantContextBudget.keepRecent && plan.messages.length) {
        const boundary = plan.messages.at(-1)!;
        const summary = yield* generateAgent(
          compactAssistantAgent,
          {
            previous: plan.memory?.summary ?? '',
            messages: plan.messages.map(({ role, text }) => ({ role, text }))
          },
          {
            maxRetries: 0,
            preflight: notes
              .replySnapshot({ requestId })
              .pipe(Effect.asVoid, Effect.provideService(Database, database))
          }
        );
        const now = yield* Clock.currentTimeMillis;

        yield* withPublicationGuard(
          database.store,
          notes.saveAssistantMemory({
            noteId: snapshot.noteId,
            throughMessageId: boundary.messageId,
            summary,
            updatedAtMs: BigInt(now)
          })
        );
        plan = yield* notes.assistantCompactionPlan({
          noteId: snapshot.noteId,
          throughMessageId
        });
      }

      return plan.memory;
    }
  });
}

/** Reanswers share receipts with the immutable user question, preventing repeated side effects. */
function durableAssistantTool(
  notes: Context.Service.Shape<typeof Notes>,
  database: Database['Service'],
  versionId: typeof versionIdSchema.Type | undefined
): NonNullable<AgentEnvironment['runTool']> {
  return (call, execute) =>
    Effect.gen(function* () {
      if (versionId === undefined || !call.mutates) return yield* execute;

      const key = { versionId, name: call.name, ordinal: call.ordinal };
      const intent = yield* withPublicationGuard(
        database.store,
        notes.retainAssistantTool({ ...key, input: call.input })
      );

      if (impactToken(sortedJson(intent.input)) !== impactToken(sortedJson(call.input)))
        return yield* Effect.fail(
          new StudyError(
            'invalid_input',
            'This tool intent changed during retry. Inspect the previous result before requesting a new action.'
          )
        );

      if (Option.isSome(intent.result)) return intent.result.value;

      const result = yield* withPublicationGuard(database.store, execute);

      return yield* withPublicationGuard(
        database.store,
        notes.completeAssistantTool({ ...key, result })
      );
    }).pipe(Effect.provideService(Database, database));
}

function sortedJson(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) return value.map(sortedJson);

  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortedJson(item)])
    );

  return value;
}

function memoryAfterQuestion(
  memory: typeof assistantMemorySchema.Type | null,
  throughMessageId: typeof assistantMemorySchema.Type.throughMessageId
) {
  return memory !== null && memory.throughMessageId >= throughMessageId;
}

function needsCompaction(plan: {
  characters: number;
  memory: typeof assistantMemorySchema.Type | null;
}) {
  return plan.characters + (plan.memory?.summary.length ?? 0) >= assistantContextBudget.compactAt;
}

export function toolRunnerForReply(
  mode: NoteMode,
  notes: Context.Service.Shape<typeof Notes>,
  database: Database['Service'],
  snapshot: typeof replySnapshotSchema.Type,
  fallback: AgentEnvironment['runTool']
) {
  return mode === NoteMode.Assistant
    ? durableAssistantTool(notes, database, snapshot.messages.at(-1)?.versionId)
    : fallback;
}
