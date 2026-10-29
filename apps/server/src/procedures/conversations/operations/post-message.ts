import * as schema from '@study/db/schema';
import { sql, eq } from 'drizzle-orm';

import { recording as opRecording } from '#server/procedures/recordings/operations/recording';
import type { ServerContext } from '#server/runtime/context';
import type { NewMessage, ChatMessage } from '#server/shared/conversations/messages';
import { StudyError } from '#server/shared/errors/index';
import type { MessageId, VersionId } from '#server/shared/ids';

import { message as opMessage } from './messages.ts';

export function postMessage(ctx: ServerContext, input: NewMessage): ChatMessage {
  return ctx.transaction(() => {
    const text = normalizeText(input.text, Boolean(input.attachments?.length));

    if (!text && !input.attachments?.length)
      throw new StudyError('invalid_input', 'message cannot be empty');

    if (input.threadRoot != null) {
      const root = ctx.db.orm.get<Record<string, unknown>>(
        sql`SELECT m.session_id,m.thread_root FROM message_parts p JOIN messages m ON m.id=p.message_id WHERE p.id=${input.threadRoot}`
      );

      if (!root || root.session_id !== input.sessionId || root.thread_root !== null)
        throw new StudyError('invalid_input', 'invalid thread root');
    }

    if (input.replyTo != null) {
      const replied = ctx.db.orm.get<Record<string, unknown>>(
        sql`SELECT session_id,thread_root,role FROM messages WHERE id=${input.replyTo}`
      );

      if (
        input.role !== 'assistant' ||
        !replied ||
        replied.role !== 'user' ||
        replied.session_id !== input.sessionId ||
        replied.thread_root !== (input.threadRoot ?? null)
      )
        throw new StudyError('invalid_input', 'invalid reply target');
    }

    if (input.recordingId != null) {
      const rec = opRecording(ctx, input.recordingId);

      if (
        !rec ||
        rec.sessionId !== input.sessionId ||
        input.recordingMs == null ||
        input.recordingMs < 0n
      )
        throw new StudyError('invalid_input', 'invalid recording reference');
    }

    if (input.recordingMs != null && (input.recordingId == null || input.recordingMs < 0n))
      throw new StudyError('invalid_input', 'invalid recording time');

    const id = ctx.db.orm.run(
      sql`INSERT INTO messages (session_id,role,reply_to,thread_root,recording_id,recording_ms,created_at) VALUES (${input.sessionId},${input.role ?? 'user'},${input.replyTo ?? null},${input.threadRoot ?? null},${input.recordingId ?? null},${input.recordingMs ?? null},${now()})`
    ).lastInsertRowid as MessageId;

    if (text) {
      const version = ctx.db.orm.run(
        sql`INSERT INTO message_versions (message_id,number,origin,status,text,created_at) VALUES (${id},1,'typed','complete',${text},${now()})`
      ).lastInsertRowid as VersionId;

      ctx.db.orm.run(sql`UPDATE messages SET active_version_id=${version} WHERE id=${id}`);
    }

    (input.attachments ?? []).forEach((sourceId, ordinal) => {
      const source = ctx.db.orm.get<Record<string, unknown>>(
        sql`SELECT name,kind FROM sources WHERE id=${sourceId}`
      );

      if (!source) throw new StudyError('not_found', 'attachment not found');

      ctx.db.orm.run(
        sql`INSERT INTO message_parts (message_id,ordinal,source_id,source_name,source_kind) VALUES (${id},${ordinal},${sourceId},${source.name as string},${source.kind as string})`
      );
    });
    ctx.db.orm
      .update(schema.sessions)
      .set({
        updated_at: now()
      })
      .where(eq(schema.sessions.id, input.sessionId))
      .run();

    return opMessage(ctx, id)!;
  });
}

export function now(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function normalizeText(value: string, allowEmpty = false): string {
  const text = value.trim();

  if ((!allowEmpty && !text) || [...text].length > 100_000)
    throw new StudyError('invalid_input', 'invalid message text');

  return text;
}
