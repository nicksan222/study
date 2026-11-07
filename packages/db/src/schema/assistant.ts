import type { SessionId, MessageId, VersionId } from '@study/contracts/ids';

import { sql, defineTable, text, integer, check, primaryKey } from '../schema-builder.ts';
import { sessions, messages, message_versions } from './conversations.ts';

export const assistant_chat_starts = defineTable({
  role: 'internal',
  reason: 'Idempotent private Assistant chat creation is not searchable content.'
})('assistant_chat_starts', {
  key: text().primaryKey(),
  session_id: integer()
    .$type<SessionId>()
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: 'cascade' })
});

export const assistant_memory = defineTable({
  role: 'internal',
  reason: 'Private conversation compaction is contextual memory rather than study content.'
})(
  'assistant_memory',
  {
    session_id: integer()
      .$type<SessionId>()
      .primaryKey()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    through_message_id: integer()
      .$type<MessageId>()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    summary: text().notNull(),
    updated_at_ms: integer().$type<bigint>().notNull()
  },
  (t) => [check('assistant_memory_summary_check', sql`length(${t.summary}) BETWEEN 1 AND 16000`)]
);

/** Intent is recorded before execution; results survive generation retries and reanswers. */
export const assistant_tool_receipts = defineTable({
  role: 'internal',
  reason: 'Private tool intents and results are retained for safe action replay.'
})(
  'assistant_tool_receipts',
  {
    version_id: integer()
      .$type<VersionId>()
      .notNull()
      .references(() => message_versions.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    ordinal: integer().notNull(),
    input: text().notNull(),
    result: text()
  },
  (t) => [
    primaryKey({ columns: [t.version_id, t.name, t.ordinal] }),
    check('assistant_tool_input_json', sql`json_valid(${t.input})`),
    check('assistant_tool_result_json', sql`${t.result} IS NULL OR json_valid(${t.result})`)
  ]
);
