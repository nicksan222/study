import { z } from 'zod';

import { enqueueJob } from '#backend/procedures/jobs/worker';
import { storeSource } from '#backend/procedures/sources/upload-source';
import { publicProcedure, idInput, router } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import { sniff } from '#backend/shared/sources/sniff';

import { sourceMaterial } from './source-material.ts';

const natural = z.bigint().min(0n).max(9223372036854775807n).nullable().optional();

const positive = z.bigint().min(1n).max(9223372036854775807n).nullable().optional();

const uploadFile = publicProcedure
  .input(
    z
      .object({
        projectId: idInput,
        sessionId: idInput.optional(),
        name: z.string().trim().min(1).max(1024),
        bytes: z.instanceof(Uint8Array),
        durationMs: natural,
        sampleRate: positive,
        channels: positive,
        width: positive,
        height: positive
      })
      .refine((v) => (v.width == null) === (v.height == null))
  )
  .mutation(({ ctx, input }) => {
    const material = ctx.store.transaction(() => {
      const source = storeSource(
        ctx.store,
        {
          name: input.name,
          bytes: input.bytes,
          ...sniff(input.name, input.bytes.subarray(0, 8192)),
          origin: 'import',
          projectId: input.projectId
        },
        input
      );

      enqueueJob(ctx.store, {
        kind: source.kind === 'link' ? 'fetch' : 'extract',
        target: { type: 'source', id: source.id }
      });

      return sourceMaterial(ctx.store, source, input)!;
    });

    ctx.wake();

    return material;
  });

const addLink = publicProcedure
  .input(
    z.object({
      projectId: idInput,
      sessionId: idInput.optional(),
      url: z.string().trim(),
      title: z.string().trim().min(1).max(200).optional()
    })
  )
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

    return material;
  });

export const ingestionRouter = router({ uploadFile, addLink });
