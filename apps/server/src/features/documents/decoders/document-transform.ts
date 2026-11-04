/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates derivative Documents against captured passage and asset authorization.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects fabricated provenance, unauthorized assets and citations.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This feature validator reads typed captures without accessing persistence or             │
 * │ providers.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { authoredContentSchema } from '@study/contracts/documents/schemas';
import type { transformPublicationSchema } from '@study/contracts/documents/transform';
import { StudyError } from '@study/contracts/errors';
import type { StudyDocumentVersionId, VersionId } from '@study/contracts/ids';
import { hasTextualContent } from '@study/contracts/sources/schemas';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

type Blocks = typeof documentSchema.Type.blocks;

export function validateDocumentTransform(
  context: typeof runSelectionContextSchema.Type,
  publication: typeof transformPublicationSchema.Type,
  editTargetVersionId?: StudyDocumentVersionId
) {
  const content = Schema.decodeUnknownSync(authoredContentSchema)(publication.document);

  if (!content.blocks.length || !content.blocks.some((block) => hasTextualContent(block.content)))
    throw new StudyError('invalid_input', 'Generated Document is empty');

  if (
    JSON.stringify({ content, report: publication.report }, (_, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value
    ).length > 100000
  )
    throw new StudyError('invalid_input', 'Generated Document exceeds limits');

  if (!publication.report) throw new StudyError('invalid_input', 'Transform report is required');

  validateBlockAuthorization(context, content.blocks, editTargetVersionId);
  validateReportTargets(content.blocks, publication.report);
  validateCitationScope(context, publication, content.blocks);
}

function validateBlockAuthorization(
  context: typeof runSelectionContextSchema.Type,
  blocks: Blocks,
  editTargetVersionId?: StudyDocumentVersionId
) {
  const originalIds = new Set(
    context.inputs.flatMap((input) => [
      ...input.excerpts.map((excerpt) => excerpt.blockId),
      ...(input.document?.blocks.map((block) => block.id) ?? [])
    ])
  );
  const editingIds = new Set(
    context.inputs
      .find(
        (input) => input.input.kind === 'document' && input.input.versionId === editTargetVersionId
      )
      ?.document?.blocks.map((block) => block.id) ?? []
  );
  const assets = new Set(
    authorizedTransformAssets(context).map((asset) => `${asset.sourceId}:${asset.revision}`)
  );

  for (const block of blocks) {
    if (
      (originalIds.has(block.id) && !editingIds.has(block.id)) ||
      block.anchor.type !== 'authored'
    )
      throw new StudyError('invalid_input', 'Derivative blocks require fresh authored identities');

    if (
      block.content.type === 'image' &&
      !assets.has(`${block.content.sourceId}:${block.content.revision}`)
    )
      throw new StudyError('invalid_input', 'Image is outside captured asset authorization');
  }
}

function validateReportTargets(
  blocks: Blocks,
  report: NonNullable<typeof transformPublicationSchema.Type.report>
) {
  const ids = new Set(blocks.map((block) => String(block.id)));

  for (const note of report.notes)
    if (note.blockIds.some((id) => !ids.has(id)))
      throw new StudyError('invalid_input', 'Transform report targets an unavailable block');
}

function validateCitationScope(
  context: typeof runSelectionContextSchema.Type,
  publication: typeof transformPublicationSchema.Type,
  blocks: Blocks
) {
  const markers = new Set(publication.citations.map((citation) => String(citation.marker)));
  const citedText = [
    ...blocks.map((block) => block.text),
    ...(publication.report?.notes ?? []).map((note) => note.explanation)
  ].join('\n');

  if ([...citedText.matchAll(/\[(\d+)\]/g)].some((match) => !markers.has(match[1]!)))
    throw new StudyError('invalid_input', 'Output cites unavailable evidence');

  for (const citation of publication.citations) validateCapturedCitation(context, citation);

  if (context.inputs.length && !publication.citations.length)
    throw new StudyError('invalid_input', 'Document must cite captured passages');
}

/** Whole/block captures authorize structured assets; ranges carry text only. */
export function authorizedTransformAssets(context: typeof runSelectionContextSchema.Type) {
  return context.inputs.flatMap((input) =>
    input.scope.kind === 'ranges'
      ? []
      : (input.document
          ? input.document.blocks.map((block) => block.content)
          : input.excerpts.flatMap((excerpt) => (excerpt.content ? [excerpt.content] : []))
        ).flatMap((content) => (content.type === 'image' ? [content] : []))
  );
}

type TransformCitation = (typeof transformPublicationSchema.Type.citations)[number];

function assertCapturedMessage(
  context: typeof runSelectionContextSchema.Type,
  citation: TransformCitation,
  versionId: VersionId
) {
  if (
    citation.target !== null ||
    citation.anchor.type !== 'authored' ||
    !context.messages.some(
      (message) => message.versionId === versionId && message.text.includes(citation.quote)
    )
  )
    throw new StudyError('invalid_input', 'Citation is outside captured messages');
}

function capturedExcerptMatches(
  excerpt: (typeof runSelectionContextSchema.Type.inputs)[number]['excerpts'][number],
  citation: TransformCitation,
  range: NonNullable<TransformCitation['target']>
) {
  return (
    excerpt.blockId === range.blockId &&
    excerpt.start === range.start &&
    excerpt.end === range.end &&
    excerpt.text.includes(citation.quote) &&
    JSON.stringify(excerpt.anchor) === JSON.stringify(citation.anchor)
  );
}

function validateCapturedCitation(
  context: typeof runSelectionContextSchema.Type,
  citation: (typeof transformPublicationSchema.Type.citations)[number]
) {
  const reference = citation.input;

  if (reference.kind === 'message') {
    assertCapturedMessage(context, citation, reference.versionId);

    return;
  }

  if (reference.kind !== 'document' && reference.kind !== 'source')
    throw new StudyError('invalid_input', 'Citation is outside captured passages');

  if (reference.kind === 'source' && reference.snapshotId === null)
    throw new StudyError('invalid_input', 'Citation has no extraction');

  const key =
    reference.kind === 'document'
      ? selectionReferenceKey(reference)
      : selectionReferenceKey({ ...reference, snapshotId: reference.snapshotId! });
  const target = context.inputs.find((input) => selectionReferenceKey(input.input) === key);
  const range = citation.target;

  if (
    !range ||
    !target ||
    !target.excerpts.some((excerpt) => capturedExcerptMatches(excerpt, citation, range))
  )
    throw new StudyError('invalid_input', 'Citation is outside captured passages');
}
