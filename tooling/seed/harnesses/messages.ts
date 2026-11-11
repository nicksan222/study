import type { NoteId } from '@study/contracts/ids';
import { eq } from '@study/db';
import type { DbTransaction } from '@study/db';
import { messages, message_versions } from '@study/db/schema';

import type { Exchange } from '../types.ts';

export function createMessages(
  db: DbTransaction,
  noteId: NoteId,
  exchanges: readonly Exchange[],
  time: bigint
) {
  for (const [index, [prompt, response]] of exchanges.entries()) {
    const question = db.orm
      .insert(messages)
      .values({
        note_id: noteId,
        role: 'user',
        created_at: time + BigInt(index * 120)
      })
      .returning()
      .get();
    const answer = db.orm
      .insert(messages)
      .values({
        note_id: noteId,
        role: 'assistant',
        reply_to: question.id,
        created_at: question.created_at + 30n
      })
      .returning()
      .get();

    for (const [message, text, origin] of [
      [question, prompt, 'typed'],
      [answer, response, 'answer']
    ] as const) {
      const version = db.orm
        .insert(message_versions)
        .values({
          message_id: message.id,
          number: 1n,
          origin,
          status: 'complete',
          text,
          created_at: message.created_at
        })
        .returning()
        .get();

      db.orm
        .update(messages)
        .set({ active_version_id: version.id })
        .where(eq(messages.id, message.id))
        .run();
    }
  }
}
