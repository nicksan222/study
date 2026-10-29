import { message } from '#server/procedures/conversations/operations/messages';
import { pendingAttachmentReads } from '#server/procedures/conversations/operations/reanswer';
import { createPendingVersion } from '#server/procedures/conversations/operations/rewrite-message';
import { targetJobs } from '#server/procedures/jobs/operations/job-overviews';
import { enqueueJob } from '#server/procedures/jobs/worker';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const { store, wake } = ctx;
    const current = message(store, input.id);

    if (!current || current.role !== 'assistant' || !current.replyTo)
      return { type: 'unavailable' as const };

    if (
      targetJobs(store, 'message', current.id).some(
        (job) =>
          job.kind === 'reply' && ['blocked', 'queued', 'waiting', 'running'].includes(job.status)
      )
    )
      return { type: 'busy' as const };

    const jobId = store.transaction(() => {
      const versionId = createPendingVersion(store, current.id, 'answer')!;

      return enqueueJob(store, {
        kind: 'reply',
        target: { type: 'message', id: current.id },
        args: { versionId: String(versionId) },
        after: pendingAttachmentReads(store, current.replyTo!)
      });
    });

    wake();

    return { type: 'queued' as const, jobId };
  });
