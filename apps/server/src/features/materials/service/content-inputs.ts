/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves exact readable evidence through its public source and Document owners.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves exact readable evidence through its public source and Document owners.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { isDeepStrictEqual } from 'node:util';

import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import { resolvedContentInputSchema } from '@study/contracts/inputs';
import type { ContentInput } from '@study/contracts/inputs';
import type { learningCitationSchema } from '@study/contracts/materials/inputs';
import { validBlockTextRange } from '@study/contracts/sources/document';
import { hasTextualContent } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Learning consumes canonical exact content only through each public owner. */
export function readContentInput(
  tx: Transaction,
  input: ContentInput,
  projectId?: ProjectId,
  allowArchived = false
) {
  if (input.kind === 'source') {
    const source = Sources.sourceInTransaction(tx, input.sourceId);

    if (projectId !== undefined && source.projectId !== projectId)
      throw new StudyError('invalid_input', 'Source is outside the requested project');

    const exact = Sources.extractionInTransaction(tx, input);

    return Schema.decodeUnknownSync(resolvedContentInputSchema)({ input, ...exact });
  }

  const version = Pages.versionInTransaction(tx, input.versionId);
  const document = Pages.pageInTransaction(tx, { id: version.pageId });

  if (version.status !== 'published' || (!allowArchived && document.archivedAt !== null))
    throw new StudyError('invalid_input', 'Learning requires a published authored version');

  if (projectId !== undefined && !document.projectIds.includes(projectId))
    throw new StudyError('invalid_input', 'Document is outside the requested project');

  return Schema.decodeUnknownSync(resolvedContentInputSchema)({
    input,
    ...version,
    name: document.title
  });
}

export function assertContentInputs(
  tx: Transaction,
  inputs: readonly ContentInput[],
  projectId?: ProjectId,
  textual = false
) {
  return inputs.map((input) => {
    const exact = readContentInput(tx, input, projectId);

    if (textual && !exact.document.blocks.some((block) => hasTextualContent(block.content)))
      throw new StudyError('invalid_input', 'Learning requires captured textual evidence');

    return exact;
  });
}

/** A caller may cite only an anchored passage from the retained exact owner. */
export function assertContentCitation(
  tx: Transaction,
  citation: typeof learningCitationSchema.Type,
  allowArchived = false
) {
  const { document } = readContentInput(tx, citation.input, undefined, allowArchived);
  const block = document.blocks.find(
    (block) =>
      isDeepStrictEqual(block.anchor, citation.anchor) &&
      (citation.target === undefined || block.id === citation.target.blockId) &&
      block.text.includes(citation.quote)
  );

  if (!block || !block.text.includes(citation.quote))
    throw new StudyError('invalid_input', 'Citation does not match its exact source block');

  const range = citation.target;

  if (
    range &&
    (range.blockId !== block.id ||
      !validBlockTextRange(document, range) ||
      !block.text.slice(range.start, range.end).includes(citation.quote))
  )
    throw new StudyError('invalid_input', 'Citation does not match its exact source passage');
}
