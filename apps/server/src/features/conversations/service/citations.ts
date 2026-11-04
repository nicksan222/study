/** Citation reads resolve retained exact owners and never follow their current heads. */
import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { validBlockTextRange } from '@study/contracts/sources/document';

import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

type Message = typeof chatMessageSchema.Type;
type Citation = Message['citations'][number];
const unavailable = {
  availability: 'unavailable',
  precision: 'unavailable',
  reason: 'captured_input_unavailable'
} as const;

function citationRange(citation: Citation) {
  if (citation.blockId == null || citation.rangeStart == null || citation.rangeEnd == null)
    return undefined;
  return { blockId: citation.blockId, start: citation.rangeStart, end: citation.rangeEnd };
}
function retainedCitationBody(tx: Transaction, citation: Citation) {
  const input = citation.input;
  if (!input || citation.documentId == null) return undefined;
  const exact =
    input.kind === 'document'
      ? Documents.versionInTransaction(tx, input.versionId)
      : Sources.extractionInTransaction(tx, input);
  if (
    ('status' in exact && exact.status !== 'published') ||
    exact.snapshotId !== citation.documentId
  )
    return undefined;
  return exact;
}
function resolveRetainedCitation(
  tx: Transaction,
  citation: Citation
): NonNullable<Citation['evidence']> {
  const exact = retainedCitationBody(tx, citation);
  if (!exact) return unavailable;
  const block = exact.document.blocks.find((block) => block.id === citation.blockId);
  if (!block || !block.text.includes(citation.quote)) return unavailable;
  const range = citationRange(citation);
  if (range && validBlockTextRange(exact.document, range)) {
    const excerpt = block.text.slice(range.start, range.end);
    if (excerpt.includes(citation.quote))
      return {
        availability: 'available',
        precision: 'exact',
        snapshotId: exact.snapshotId,
        excerpt
      };
  }
  return {
    availability: 'available',
    precision: 'approximate',
    snapshotId: exact.snapshotId,
    excerpt: citation.quote
  };
}
function resolveCitation(tx: Transaction, citation: Citation): NonNullable<Citation['evidence']> {
  try {
    return resolveRetainedCitation(tx, citation);
  } catch (error) {
    if (
      error instanceof StudyError &&
      (error.kind === 'not_found' || error.kind === 'invalid_input')
    )
      return unavailable;
    throw error;
  }
}
export function resolveVersionCitations(tx: Transaction, citations: Message['citations']) {
  return citations.map((citation) => {
    const evidence = resolveCitation(tx, citation);
    return { ...citation, precision: evidence.precision, evidence };
  });
}
export function resolveMessageCitations(tx: Transaction, message: Message): Message {
  return { ...message, citations: resolveVersionCitations(tx, message.citations) };
}
