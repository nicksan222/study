import * as schema from '@study/db/schema';
import { asc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import type { Recording } from '#backend/shared/conversations/messages';
import type { RecordingId } from '#backend/shared/ids';

import { recordingView, recording as opRecording } from './recording.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return {
    items: listRecordings(store).map((value) => recordingView(store, value))
  };
});

export function listRecordings(ctx: BackendContext): Recording[] {
  return ctx.db.orm
    .select({
      id: schema.recordings.id
    })
    .from(schema.recordings)
    .orderBy(asc(schema.recordings.id))
    .all()
    .map((row) => opRecording(ctx, row.id as RecordingId)!);
}
