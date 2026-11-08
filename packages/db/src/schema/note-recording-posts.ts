import type { MessageId, NoteId } from '@study/contracts/ids';

import { defineTable, sql, check, integer, text, uniqueIndex } from '../schema-builder.ts';
import { notes } from './notes.ts';

// The message ID is historical: deleting a message must not permit a second publication.
export const note_recording_posts = defineTable({
  role: 'internal',
  reason: 'Private operational state outside searchable published content'
})(
  'note_recording_posts',
  {
    request_id: text().primaryKey(),
    note_id: integer()
      .$type<NoteId>()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    input_hash: text().notNull(),
    message_id: integer().$type<MessageId>().notNull()
  },
  (t) => [
    uniqueIndex('note_recording_posts_message_idx').on(t.message_id),
    check('note_recording_posts_request_check', sql`length(trim(${t.request_id})) > 0`),
    check(
      'note_recording_posts_hash_check',
      sql`length(${t.input_hash}) = 64 AND ${t.input_hash} NOT GLOB '*[^0-9a-f]*'`
    ),
    check('note_recording_posts_message_check', sql`${t.message_id} > 0`)
  ]
);
