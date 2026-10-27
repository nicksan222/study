import * as schema from '@study/db/schema';
import { mentionLabel } from '@study/localization';
import { sql, eq } from 'drizzle-orm';
import { z } from 'zod';

import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import { recording as opRecording } from '#backend/procedures/recordings/recording';
import { importFile } from '#backend/procedures/sources/import-file';
import { setSourceProject as opSetSourceProject } from '#backend/procedures/sources/set-source-project';
import { source as opSource } from '#backend/procedures/sources/source';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import type { NewMessage, ChatMessage } from '#backend/shared/conversations/messages';
import { StudyError } from '#backend/shared/errors/index';
import type { SessionId, PartId } from '#backend/shared/ids';
import type { MessageId, VersionId } from '#backend/shared/ids';

import { listAllSessions as opListAllSessions } from './all-sessions.ts';
import { messageView, message as opMessage, listMessages as opListMessages } from './messages.ts';
import { requestReply as opRequestReply } from './reanswer.ts';
import { session as opSession } from './session.ts';

export const run = publicProcedure
  .input(
    z.object({
      place: z.object({
        type: z.enum(['timeline', 'thread']),
        id: idInput
      }),
      text: z.string().default(''),
      files: z.array(z.string()).max(100).default([]),
      attachments: z.array(idInput).max(100).default([])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;

    if (r.files.length + r.attachments.length > 100 || r.text.length > 1000000)
      invalid('Message too large');

    let sessionId: SessionId;
    let threadRoot: PartId | null = null;

    if (r.place.type === 'timeline') sessionId = r.place.id;
    else if (r.place.type === 'thread') {
      threadRoot = r.place.id;
      const owner = opListAllSessions(store)
        .flatMap((s) => opListMessages(store, s.id))
        .find((m) => m.parts.some((p) => p.id === threadRoot));

      if (!owner) throw new StudyError('not_found', 'Thread missing');

      sessionId = owner.sessionId;
    } else return invalid('Message destination required');

    const session = opSession(store, sessionId);

    if (!session) throw new StudyError('not_found', 'Session missing');

    const posted = store.transaction(() => {
      const existing = r.attachments.map((value) => {
        const id = value;
        const source = opSource(store, id);

        if (!source) throw new StudyError('not_found', 'Attachment missing');

        if (source.projectId !== null && source.projectId !== session.projectId)
          invalid('Attachment belongs to another project');

        if (source.projectId === null) opSetSourceProject(store, id, session.projectId);

        return id;
      });
      const attachments = [
        ...new Set([
          ...existing,
          ...r.files.map((path) => {
            const source = importFile(store, path, session.projectId);

            return source.id;
          })
        ])
      ];
      const result = postMessage(store, {
        sessionId,
        text: r.text,
        threadRoot,
        attachments
      });

      if (
        [...r.text.matchAll(/(?:^|\s)(@[a-z]+)/giu)].some(
          (match) => match[1].toLowerCase() === mentionLabel('assistant')
        )
      )
        opRequestReply(store, result.id);

      if (session.titleSource === 'provisional' && threadRoot === null)
        opEnqueueJob(store, {
          kind: 'title',
          target: {
            type: 'session',
            id: sessionId
          }
        });

      return result;
    });

    wake();

    return messageView(store, posted);
  });

export function postMessage(ctx: BackendContext, input: NewMessage): ChatMessage {
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
