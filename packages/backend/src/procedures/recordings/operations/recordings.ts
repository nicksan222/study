import * as schema from '@study/db/schema';
import { asc } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import type { RecordingId } from '#backend/shared/ids';
import type { Recording } from '#backend/shared/recordings/schemas';

import { recording } from './recording.ts';

export function listRecordings(ctx: BackendContext): Recording[] {
  return ctx.db.orm
    .select({
      id: schema.recordings.id
    })
    .from(schema.recordings)
    .orderBy(asc(schema.recordings.id))
    .all()
    .map((row) => recording(ctx, row.id as RecordingId)!);
}
