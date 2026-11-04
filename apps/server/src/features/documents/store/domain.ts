/** Composes private authored persistence for synchronous caller-owned transactions. */
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDocumentEditing } from './editing.ts';
import { makeDocumentGeneration } from './generation.ts';
import { makeDocumentHistory } from './history.ts';
import { makeDocumentProposals } from './proposals.ts';
import { makeDocumentEvidence } from './provenance.ts';
import { makeDocumentReads } from './reads.ts';
import { makeDocumentRevisions } from './revisions.ts';

export function makeDocumentDomain(resources: StoreResources) {
  const reads = makeDocumentReads(resources);
  const evidence = makeDocumentEvidence(resources, reads);
  const revisions = makeDocumentRevisions(resources, reads, evidence);
  const editing = makeDocumentEditing(resources, reads, revisions, evidence);
  const history = makeDocumentHistory(resources, reads);
  const generation = makeDocumentGeneration(resources, reads, revisions, evidence, editing);
  const proposals = makeDocumentProposals(resources, reads, revisions, evidence, editing);
  return { ...reads, ...editing, ...history, ...generation, ...proposals };
}
