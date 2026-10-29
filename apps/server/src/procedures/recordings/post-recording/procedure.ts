import { messageView } from '#server/procedures/conversations/operations/messages';
import { enqueueJob } from '#server/procedures/jobs/worker';
import { postRecording } from '#server/procedures/recordings/operations/post-recording';
import { recording } from '#server/procedures/recordings/operations/recording';
import { source as opSource } from '#server/procedures/sources/operations/source';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const recordingValue = recording(ctx.store, input.recording);

    if (!recordingValue) throw new StudyError('not_found', 'Recording missing');

    if (recordingValue.sessionId !== input.session)
      throw new StudyError('invalid_input', 'Recording belongs to another session');

    const posted = ctx.store.transaction(() => {
      const result = postRecording(ctx.store, input.recording, input.name);

      for (const part of result.parts)
        if (part.sourceId) {
          const source = opSource(ctx.store, part.sourceId);

          if (source)
            enqueueJob(ctx.store, { kind: 'extract', target: { type: 'source', id: source.id } });
        }

      return result;
    });

    ctx.wake();

    return messageView(ctx.store, posted);
  });
