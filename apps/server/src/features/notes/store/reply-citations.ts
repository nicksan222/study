/** @file Owns reply citations within this feature. */

import type { publishReplyInputSchema, runSelectionContextSchema } from '@study/contracts';
import type { citations } from '@study/db';

type ReplyCitation = (typeof publishReplyInputSchema.Type.citations)[number];

type SelectedInput = (typeof runSelectionContextSchema.Type.inputs)[number];

export function citationExcerpt(selected: SelectedInput, citation: ReplyCitation) {
  const range = citation.selectedRange;

  if (!range) return undefined;

  return selected.excerpts.find(
    (item) =>
      item.blockOrdinal === citation.blockOrdinal &&
      item.blockId === range.blockId &&
      item.start === range.start &&
      item.end === range.end &&
      item.text.includes(citation.quote)
  );
}

export function selectedCitationIdentity(input: SelectedInput['input']) {
  return input.kind === 'source'
    ? { source_id: input.sourceId, authored_version_id: null, source_revision: input.revision }
    : { source_id: null, authored_version_id: input.versionId, source_revision: null };
}

const receiptCitationFields = [
  'marker',
  'source_id',
  'source_name',
  'authored_version_id',
  'source_revision',
  'document_id',
  'block_id',
  'range_start',
  'range_end',
  'anchor',
  'quote'
] as const;

type ReceiptCitation = Pick<typeof citations.$inferSelect, (typeof receiptCitationFields)[number]>;

export function sameReceiptCitation(actual: ReceiptCitation, expected: ReceiptCitation) {
  return receiptCitationFields.every((key) => actual[key] === expected[key]);
}
