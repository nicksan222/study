import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeExactInputs } from './exact-inputs.ts';

/** Learning citations retain typed exact owners without projecting them into Materials. */
export function makeCitations(resources: StoreResources) {
  const exact = makeExactInputs(resources);
  return { readCitations: exact.citations, readCitationDetails: exact.citationValue };
}
