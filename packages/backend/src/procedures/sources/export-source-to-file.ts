import { writeFileSync } from 'node:fs';

import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { invalid } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';

import { source as dbSource, sourceBytes as dbSourceBytes } from './source.ts';

export const run = publicProcedure
  .input(
    z.object({
      sourceId: idInput,
      destination: z.string()
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;
    const id = r.sourceId;

    if (!r.destination || r.destination.length > 32768) invalid('Invalid destination');

    exportSource(store, id, r.destination);
    const source = dbSource(store, id)!;

    return {
      value: source.sizeBytes
    };
  });

export function exportSource(ctx: BackendContext, id: SourceId, path: string): void {
  const bytes = dbSourceBytes(ctx, id);

  if (!bytes) throw new StudyError('not_found', 'source does not exist');

  writeFileSync(path, bytes);
}
