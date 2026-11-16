import type { SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Option } from 'effect';

export async function deleteSourceRecovering(id: SourceId) {
  try {
    await rpc.sources.delete.call({ id });
  } catch (error) {
    // A lost response can be recovered through the source's durable absence.
    let absent = false;

    try {
      absent = Option.isNone(await rpc.sources.find.read({ id }));
    } catch {
      /* Keep the original failure when availability cannot be checked. */
    }

    if (!absent) throw error;
  }
}
