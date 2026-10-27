import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { targetJobs, listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { JobId } from '#backend/shared/ids';
import type { MessageId } from '#backend/shared/ids';
import type { SourceId } from '#backend/shared/ids';

import { message as opMessage } from './messages.ts';
import { now } from './post-message.ts';
import { createPendingVersion as opCreatePendingVersion } from './rewrite-message.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const id = r.id;
    const message = opMessage(store, id);

    if (!message || message.role !== 'assistant' || !message.replyTo)
      return {
        type: 'unavailable' as const
      };

    if (
      targetJobs(store, 'message', id).some(
        (j) => j.kind === 'reply' && ['blocked', 'queued', 'waiting', 'running'].includes(j.status)
      )
    )
      return {
        type: 'busy' as const
      };

    const value = store.transaction(() => {
      const versionId = opCreatePendingVersion(store, id, 'answer')!;

      return opEnqueueJob(store, {
        kind: 'reply',
        target: {
          type: 'message',
          id
        },
        args: {
          versionId: String(versionId)
        },
        after: pendingAttachmentReads(store, message.replyTo!)
      });
    });

    wake();

    return {
      type: 'queued' as const,
      jobId: value
    };
  });

export function createReply(ctx: BackendContext, userId: MessageId): MessageId {
  return ctx.transaction(() => {
    const user = opMessage(ctx, userId);

    if (!user || user.role !== 'user')
      throw new StudyError('invalid_input', 'reply target must be a user message');

    const id = ctx.db.orm.run(
      sql`INSERT INTO messages (session_id,role,reply_to,thread_root,created_at) VALUES (${user.sessionId},'assistant',${userId},${user.threadRoot},${now()})`
    ).lastInsertRowid as MessageId;

    return id;
  });
}

export function pendingAttachmentReads(ctx: BackendContext, id: MessageId): JobId[] {
  const message = opMessage(ctx, id);

  if (!message) return [];

  const sources = new Set(
    message.parts.flatMap((part) => (part.sourceId === null ? [] : [part.sourceId]))
  );

  if (message.threadRoot !== null) {
    const root = ctx.db.orm.get<{
      source_id: bigint | null;
    }>(sql`SELECT source_id FROM message_parts WHERE id=${message.threadRoot}`);

    if (root?.source_id != null) sources.add(root.source_id as SourceId);
  }

  return opListJobs(ctx)
    .filter(
      (job) =>
        job.target.type === 'source' &&
        sources.has(job.target.id) &&
        ['fetch', 'extract'].includes(job.kind) &&
        ['queued', 'blocked', 'waiting', 'running'].includes(job.status)
    )
    .map((job) => job.id);
}

export function requestReply(ctx: BackendContext, userId: MessageId) {
  return ctx.transaction(() => {
    const messageId = createReply(ctx, userId);
    const versionId = opCreatePendingVersion(ctx, messageId, 'answer')!;
    const jobId = opEnqueueJob(ctx, {
      kind: 'reply',
      target: {
        type: 'message',
        id: messageId
      },
      args: {
        versionId: versionId.toString()
      },
      after: pendingAttachmentReads(ctx, userId)
    });

    return {
      messageId,
      versionId,
      jobId
    };
  });
}
