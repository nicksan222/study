/** @file Owns attachment gate within this feature. */

import type { SourceId } from '@study/contracts';
import { failureSchema } from '@study/contracts';
import { DurableDeferred } from 'effect/workflow';

export const attachmentGate = (sourceId: SourceId, requestId: string) =>
  DurableDeferred.make(`attachment/${sourceId}/${requestId}`, { error: failureSchema });
