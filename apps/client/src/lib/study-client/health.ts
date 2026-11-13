import { Effect } from 'effect';

import { request } from './request';

/** Bound health probes so a stalled endpoint can recover through the next poll. */
export const loadServerHealth = (signal: AbortSignal) =>
  request((client) => client['system.health']({}).pipe(Effect.timeout('4 seconds')), signal);
