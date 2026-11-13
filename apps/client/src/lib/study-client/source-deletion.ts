import type { SourceId } from '@study/contracts/ids';
import { Option } from 'effect';

import { request } from './request';

export async function deleteSourceRecovering(id: SourceId) {
  try {
    await request((rpc) => rpc['sources.deleteSource']({ id }));
  } catch (error) {
    // A lost response can be recovered through the source's durable absence.
    let absent = false;

    try {
      absent = Option.isNone(await request((rpc) => rpc['sources.findSource']({ id })));
    } catch {
      /* Keep the original failure when availability cannot be checked. */
    }

    if (!absent) throw error;
  }
}
