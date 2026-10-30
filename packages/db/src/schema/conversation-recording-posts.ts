import type { MessageId, SessionId } from '@study/contracts/ids';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { sessions } from './conversations.ts';

// The message ID is historical: deleting a message must not permit a second publication.
export const conversation_recording_posts = sqliteTable(
  'conversation_recording_posts',
  {
    request_id: text().primaryKey(),
    session_id: integer()
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    input_hash: text().notNull(),
    message_id: integer().$type<MessageId>().notNull()
  },
  (t) => [
    uniqueIndex('conversation_recording_posts_message_idx').on(t.message_id),
    check('conversation_recording_posts_request_check', sql`length(trim(${t.request_id})) > 0`),
    check(
      'conversation_recording_posts_hash_check',
      sql`length(${t.input_hash}) = 64 AND ${t.input_hash} NOT GLOB '*[^0-9a-f]*'`
    ),
    check('conversation_recording_posts_message_check', sql`${t.message_id} > 0`)
  ]
);
