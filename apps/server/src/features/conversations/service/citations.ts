/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes historic Material evidence into conversation citation reads.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves stored citation coordinates while resolving their current availability.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the public Materials participant; conversation persistence stays private.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { chatMessageSchema } from '@study/contracts/conversations/schemas';

import { Materials } from '#server/features/materials/index';
import type { Transaction } from '#server/platform/definitions/define-store';

type Message = typeof chatMessageSchema.Type;

type Citation = Message['citations'][number];

function resolveCitation(tx: Transaction, citation: Citation): NonNullable<Citation['evidence']> {
  if (citation.materialVersionId == null)
    return {
      availability: 'unavailable',
      precision: 'approximate',
      reason: 'attachment_target_unresolved',
      sourceId: citation.sourceId,
      anchor: citation.anchor,
      quote: citation.quote
    };

  const retained = Materials.resolveEvidence(tx, {
    kind: 'anchor',
    versionId: citation.materialVersionId,
    anchor: citation.anchor,
    quote: citation.quote
  });

  if (
    retained.availability === 'unavailable' ||
    citation.documentId == null ||
    citation.blockId == null ||
    citation.rangeStart == null ||
    citation.rangeEnd == null
  )
    return retained;

  return Materials.resolveEvidence(tx, {
    kind: 'range',
    target: {
      materialId: retained.materialId,
      range: {
        versionId: citation.materialVersionId,
        documentId: citation.documentId,
        blockId: citation.blockId,
        start: citation.rangeStart,
        end: citation.rangeEnd
      }
    }
  });
}

export function resolveVersionCitations(tx: Transaction, citations: Message['citations']) {
  return citations.map((citation) => {
    const evidence = resolveCitation(tx, citation);

    return { ...citation, precision: evidence.precision, evidence };
  });
}

export function resolveMessageCitations(tx: Transaction, message: Message): Message {
  return {
    ...message,
    citations: resolveVersionCitations(tx, message.citations)
  };
}
