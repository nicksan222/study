import { Schema } from 'effect';

import { sourceMaterial } from '#server/procedures/ingestion/source-material';
import { enqueueJob } from '#server/procedures/jobs/worker';
import { storeSource } from '#server/procedures/sources/operations/upload-source';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputSchema, outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    let url: URL;

    try {
      url = new URL(input.url);
    } catch {
      throw new StudyError('invalid_input', 'Invalid URL');
    }

    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new StudyError('invalid_input', 'Invalid URL');

    const material = ctx.store.transaction(() => {
      const source = storeSource(
        ctx.store,
        {
          name: input.title ?? url.href,
          bytes: Buffer.from(url.href),
          kind: 'link',
          mime: 'text/uri-list',
          origin: 'web',
          projectId: input.projectId,
          uri: url.href
        },
        input
      );

      enqueueJob(ctx.store, { kind: 'fetch', target: { type: 'source', id: source.id } });

      return sourceMaterial(ctx.store, source, input)!;
    });

    ctx.wake();

    return Schema.decodeUnknownSync(outputSchema)(material);
  });
