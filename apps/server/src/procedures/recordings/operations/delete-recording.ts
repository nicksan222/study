import * as schema from '@study/db/schema';
import { eq } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import type { RecordingId } from '#server/shared/ids';

export function deleteRecording(ctx: ServerContext, id: RecordingId): boolean {
  return (
    ctx.db.orm.delete(schema.recordings).where(eq(schema.recordings.id, id)).run().changes !== 0n
  );
}
