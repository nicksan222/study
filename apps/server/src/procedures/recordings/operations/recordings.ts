import * as schema from '@study/db/schema';
import { asc } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { RecordingId } from '#server/shared/ids';
import type { Recording } from '#server/shared/recordings/schemas';

import { recording } from './recording.ts';

export function listRecordings(ctx: ServerContext): Recording[] {
  return ctx.db.orm
    .select({
      id: schema.recordings.id
    })
    .from(schema.recordings)
    .orderBy(asc(schema.recordings.id))
    .all()
    .map((row) => recording(ctx, row.id as RecordingId)!);
}
