/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Resolves selected note evidence through public exact content services.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves selected note evidence through public exact content services.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type {
  resolvedSelectionSchema,
  noteSelectionTargetSchema
} from '@study/contracts/notes/context';
import { validBlockTextRange } from '@study/contracts/sources/document';

import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Capture exact public content inside the caller's synchronous transaction. */
export function resolveSelection(
  tx: Transaction,
  target: typeof noteSelectionTargetSchema.Type
): typeof resolvedSelectionSchema.Type {
  const content = exactContent(tx, target);
  const { document } = content;
  const scope = target.scope;
  const spans =
    scope.kind === 'ranges'
      ? scope.ranges
      : document.blocks.flatMap((block) =>
          (scope.kind === 'document' && block.text.length > 0) ||
          (scope.kind === 'blocks' && scope.blockIds.includes(block.id))
            ? [{ blockId: block.id, start: 0, end: block.text.length }]
            : []
        );

  if (
    scope.kind === 'blocks' &&
    (new Set(scope.blockIds).size !== scope.blockIds.length ||
      spans.length !== scope.blockIds.length)
  )
    throw new StudyError('invalid_input', 'Invalid selected blocks');

  const seen = new Set<string>();
  const excerpts = spans.map((range) => {
    const key = `${range.blockId}:${range.start}:${range.end}`;

    if (!validBlockTextRange(document, range) || range.start === range.end || seen.has(key))
      throw new StudyError('invalid_input', 'Invalid selected range');

    seen.add(key);
    const blockOrdinal = document.blocks.findIndex((block) => block.id === range.blockId);
    const block = document.blocks[blockOrdinal]!;

    return {
      ...range,
      blockOrdinal,
      text: block.text.slice(range.start, range.end),
      anchor: block.anchor,
      content: scope.kind === 'ranges' ? undefined : block.content
    };
  });

  if (!excerpts.length || !excerpts.some((item) => item.text.trim()))
    throw new StudyError('invalid_input', 'Selected content has no text');

  return {
    ...target,
    snapshotId: content.snapshotId,
    pageId: content.pageId,
    name: content.name,
    document: scope.kind === 'document' ? document : undefined,
    excerpts
  };
}

function exactContent(tx: Transaction, target: typeof noteSelectionTargetSchema.Type) {
  const input = target.input;

  if (input.kind === 'source') {
    const source = Sources.extractionInTransaction(tx, input);

    return { ...source, pageId: null };
  }

  const version = Pages.versionInTransaction(tx, input.versionId);

  if (version.status !== 'published')
    throw new StudyError('invalid_input', 'Selected authored version is unpublished');

  const page = Pages.pageInTransaction(tx, { id: version.pageId });

  return { ...version, name: page.title };
}
