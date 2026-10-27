import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { enqueueJob as dbEnqueueJob } from '#backend/procedures/jobs/worker';
import { titleOf } from '#backend/procedures/projects/projects';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SessionId } from '#backend/shared/ids';

import { session as dbSession } from './session.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store, wake } = context;
    const id = r.id;

    if (!dbSession(store, id)) throw new StudyError('not_found', 'Session missing');

    const value = dbEnqueueJob(store, {
      kind: 'title',
      target: {
        type: 'session',
        id
      },
      args: {
        force: true
      }
    });

    wake();

    return {
      id: value
    };
  });

export function setGeneratedTitle(ctx: BackendContext, id: SessionId, title: string): boolean {
  return (
    ctx.db.orm
      .update(schema.sessions)
      .set({
        title: titleOf(title),
        title_source: 'generated'
      })
      .where(sql`id = ${id} AND title_source = 'provisional'`)
      .run().changes !== 0n
  );
}

export function replaceWithGeneratedTitle(
  ctx: BackendContext,
  id: SessionId,
  title: string
): boolean {
  return (
    ctx.db.orm
      .update(schema.sessions)
      .set({
        title: titleOf(title),
        title_source: 'generated'
      })
      .where(sql`id = ${id}`)
      .run().changes !== 0n
  );
}
