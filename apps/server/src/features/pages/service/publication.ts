/** @file Owns publication within this feature. */

import type * as e from '@study/contracts';
import type * as evidence from '@study/contracts';
import type { Page, PageVersionId } from '@study/contracts';
import type { Transaction } from '@study/server';

function pagePublished(tx: Transaction, versionId: PageVersionId) {
  const eventId = crypto.randomUUID();

  tx.emit({
    type: 'PagePublished',
    eventId,
    causationId: null,
    correlationId: eventId,
    inputVersion: 1,
    depth: 0,
    versionId
  });
}

export function created(tx: Transaction, result: { page: Page; replayed: boolean }) {
  if (!result.replayed && result.page.version) pagePublished(tx, result.page.version.id);

  return result.page;
}

export function edited(tx: Transaction, result: typeof e.editOutcomeSchema.Type) {
  if (!result.replayed && result.outcome === 'saved') pagePublished(tx, result.submittedVersionId);

  return result;
}

export function proposalCommitted(tx: Transaction, result: typeof e.proposalOutcomeSchema.Type) {
  if (!result.replayed && result.resultVersionId !== null)
    pagePublished(tx, result.resultVersionId);

  return result;
}

export function annotationChanged(
  tx: Transaction,
  result: typeof evidence.annotationOutcomeSchema.Type
) {
  if (result.outcome === 'saved') {
    const eventId = crypto.randomUUID();

    tx.emit({
      type: 'PageAnnotationChanged',
      eventId,
      causationId: null,
      correlationId: eventId,
      inputVersion: 1,
      depth: 0,
      pageId: result.annotation.target.pageId,
      annotationId: result.annotation.id,
      revision: result.annotation.revision
    });
  }

  return result;
}
