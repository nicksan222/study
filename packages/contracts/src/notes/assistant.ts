import { Schema } from 'effect';

import { messageIdSchema, noteIdSchema, versionIdSchema } from '../ids.ts';
import { noteSchema } from './schemas.ts';

/** Study's bounded prompt budget; token counts are estimates at four characters per token. */
export const assistantContextBudget = {
  characters: 200000,
  reserve: 80000,
  compactAt: 100000,
  keepRecent: 48000,
  summary: 16000
} as const;

export const noteAssistantInputSchema = Schema.Struct({ noteId: noteIdSchema });

export const assistantNoteInputSchema = Schema.Struct({ id: Schema.optional(noteIdSchema) });

export const assistantChatStartSchema = Schema.Struct({
  key: Schema.String.check(Schema.isBetweenLength(1, 200))
});

export const assistantChatsInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(noteIdSchema)
});

export const assistantChatsSchema = Schema.Struct({
  items: Schema.Array(noteSchema),
  next: Schema.NullOr(noteIdSchema)
});

export const assistantMemorySchema = Schema.Struct({
  noteId: noteIdSchema,
  throughMessageId: messageIdSchema,
  summary: Schema.String.check(Schema.isBetweenLength(1, assistantContextBudget.summary)),
  updatedAtMs: Schema.BigInt
});

export const assistantContextInputSchema = Schema.Struct({ noteId: noteIdSchema });

export const assistantContextSchema = Schema.Struct({
  estimatedTokens: Schema.Int,
  maxTokens: Schema.Int,
  autoCompact: Schema.Literal(true),
  lastCompactedAtMs: Schema.NullOr(Schema.BigInt)
});

const assistantMemoryMessageSchema = Schema.Struct({
  messageId: messageIdSchema,
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String
});

export const assistantCompactionInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  throughMessageId: messageIdSchema
});

export const assistantCompactionPlanSchema = Schema.Struct({
  memory: Schema.NullOr(assistantMemorySchema),
  characters: Schema.Int,
  messages: Schema.Array(assistantMemoryMessageSchema)
});

const assistantToolKeySchema = Schema.Struct({
  versionId: versionIdSchema,
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/)),
  ordinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
});

export const assistantToolIntentSchema = Schema.Struct({
  ...assistantToolKeySchema.fields,
  input: Schema.Json
});

export const assistantToolReceiptSchema = Schema.Struct({
  input: Schema.Json,
  result: Schema.Option(Schema.Json)
});

export const assistantToolResultSchema = Schema.Struct({
  ...assistantToolKeySchema.fields,
  result: Schema.Json
});
