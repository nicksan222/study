/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds exact learning citation replacement to its owning persistence operations.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Binds exact learning citation replacement to its owning persistence operations.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside its feature; callers own transaction scope. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { setCitationsInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeExactInputs } from './exact-inputs.ts';
import { makeReads } from './reads.ts';

/** The service validates canonical evidence through its public owner before this write. */
export function makeSetCitationsAction(resources: StoreResources) {
  const exact = makeExactInputs(resources);
  const reads = makeReads(resources);

  return {
    setCitations: (value: typeof setCitationsInputSchema.Type) => {
      reads.versionRow(value.id, true);

      return exact.replaceCitations(value.id, value.citations);
    }
  };
}
