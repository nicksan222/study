import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { enqueueJob as opEnqueueJob } from '#backend/procedures/jobs/worker';
import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { MessageId } from '#backend/shared/ids';
import type { VersionId } from '#backend/shared/ids';

import { discardUnfinished as opDiscardUnfinished } from './edit-message.ts';
import { message as opMessage } from './messages.ts';
import { now, normalizeText } from './post-message.ts';
import { pendingAttachmentReads as opPendingAttachmentReads } from './reanswer.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput,
      how: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('improve')
        }),
        z.object({
          type: z.literal('summarize')
        }),
        z.object({
          type: z.literal('instruction'),
          instruction: z.string().min(1)
        })
      ])
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const id = r.id;
    const how = r.how;

    if (!how.type) invalid('Rewrite action required');

    if (how.type === 'instruction' && !how.instruction.trim())
      invalid('Rewrite instruction required');

    const result = requestRewrite(
      store,
      id,
      how.type,
      how.type === 'instruction' ? how.instruction : undefined
    );

    wake();

    return {
      type: 'queued' as const,
      jobId: result.jobId
    };
  });

export function createPendingVersion(
  ctx: BackendContext,
  id: MessageId,
  origin: 'answer' | 'improve' | 'summarize' | 'instruction',
  instruction?: string
): VersionId | null {
  return ctx.transaction(() => {
    const msg = opMessage(ctx, id);

    if (!msg) return null;

    if (!['answer', 'improve', 'summarize', 'instruction'].includes(origin))
      throw new StudyError('invalid_input', 'invalid version origin');

    if ((origin === 'instruction') !== Boolean(instruction?.trim()))
      throw new StudyError('invalid_input', 'invalid instruction');

    if (instruction !== undefined) instruction = normalizeText(instruction);

    opDiscardUnfinished(ctx, id);
    const version = ctx.db.orm.run(
      sql`INSERT INTO message_versions (message_id,number,origin,instruction,status,text,based_on,created_at) VALUES (${id},(SELECT COALESCE(MAX(number),0)+1 FROM message_versions WHERE message_id=${id}),${origin},${instruction?.trim() ?? null},'pending','',${msg.activeVersionId},${now()})`
    ).lastInsertRowid as VersionId;

    return version;
  });
}

export function requestRewrite(
  ctx: BackendContext,
  messageId: MessageId,
  origin: 'improve' | 'summarize' | 'instruction',
  instruction?: string
) {
  return ctx.transaction(() => {
    const versionId = createPendingVersion(ctx, messageId, origin, instruction);

    if (!versionId) throw new StudyError('not_found', 'message not found');

    const jobId = opEnqueueJob(ctx, {
      kind: 'rewrite',
      target: {
        type: 'message',
        id: messageId
      },
      args: {
        versionId: versionId.toString()
      },
      after: opPendingAttachmentReads(ctx, messageId)
    });

    return {
      messageId,
      versionId,
      jobId
    };
  });
}
