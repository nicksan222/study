import { Schema } from 'effect';

import type { DocumentId, MaterialVersionId } from '../ids.ts';
import { blockIdSchema, blockContentSchema, canonicalText } from './schemas.ts';
import type { BlockContent } from './schemas.ts';
import type { anchorSchema, documentSchema, documentTextRangeSchema } from './schemas.ts';

type Mutable<T> = T extends string | number | bigint | boolean | null
  ? T
  : T extends ReadonlyArray<infer Item>
    ? Mutable<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: Key extends 'content' ? T[Key] : Mutable<T[Key]> }
      : T;

export type Anchor = Mutable<typeof anchorSchema.Type>;

export type Document = Mutable<typeof documentSchema.Type>;

export type Block = Document['blocks'][number];

export type BlockKind = Block['kind'];

export type Stamp = Document['meta']['refiners'][number];

export type DocumentMeta = Document['meta'];

/** Fresh identity for newly extracted/authored blocks; never inferred from text or ordinal. */
export function createBlock(
  content: BlockContent,
  anchor: Anchor = { type: 'authored' },
  id = Schema.decodeUnknownSync(blockIdSchema)(crypto.randomUUID())
): Block {
  return {
    id,
    kind: content.type,
    content: structuredClone(content) as Block['content'],
    text: canonicalText(content),
    anchor
  };
}

/** Plain extractor/provider output explicitly has no richer formatting to preserve. */
export function plainBlock(kind: BlockKind, text: string, anchor: Anchor): Block {
  const inlines = [{ type: 'text' as const, text, marks: [] }];

  switch (kind) {
    case 'paragraph':
    case 'segment':
      return createBlock({ type: kind, inlines }, anchor);
    case 'heading':
      return createBlock({ type: kind, level: 1, inlines }, anchor);
    case 'code':
      return createBlock({ type: kind, code: text, language: null }, anchor);
    case 'list_item':
      return createBlock(
        { type: kind, items: [{ depth: 0, ordered: false, start: 1, inlines }] },
        anchor
      );
    case 'table':
      return createBlock(
        { type: kind, rows: [{ cells: [{ header: false, paragraphs: [inlines] }] }] },
        anchor
      );
    case 'math':
      return createBlock({ type: kind, expression: text }, anchor);
    default:
      throw new TypeError('An image or reference requires structured content');
  }
}

export const persistedBlockContent = Schema.fromJsonString(Schema.toCodecJson(blockContentSchema));

export const encodeBlockContent = Schema.encodeSync(persistedBlockContent);

export const decodeBlockContent = Schema.decodeUnknownSync(persistedBlockContent);

export type BlockId = typeof blockIdSchema.Type;

/**
 * Exact editor ranges use UTF-16 code units, matching JS strings and DOM selections.
 * A boundary inside a surrogate pair is invalid. Source anchors remain independent.
 */
export type DocumentTextRange = typeof documentTextRangeSchema.Type;

export function validDocumentTextRange(
  document: Document,
  target: { versionId: MaterialVersionId; documentId: DocumentId },
  range: DocumentTextRange
): boolean {
  if (range.versionId !== target.versionId || range.documentId !== target.documentId) return false;

  const block = document.blocks.find((item) => item.id === range.blockId);

  if (
    !block ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > block.text.length
  )
    return false;

  const boundary = (offset: number) =>
    offset === 0 ||
    offset === block.text.length ||
    !(
      block.text.charCodeAt(offset - 1) >= 0xd800 &&
      block.text.charCodeAt(offset - 1) <= 0xdbff &&
      block.text.charCodeAt(offset) >= 0xdc00 &&
      block.text.charCodeAt(offset) <= 0xdfff
    );

  return boundary(range.start) && boundary(range.end);
}

/** A plain correction retains location and identity, with explicit rich-format loss. */
export function correctBlockText(block: Block, text: string): Block {
  const content = block.content;

  switch (content.type) {
    case 'image':
      return createBlock({ ...content, alt: text }, block.anchor, block.id);
    case 'reference':
      return createBlock(
        { ...content, inlines: [{ type: 'text', text, marks: [] }] },
        block.anchor,
        block.id
      );
    case 'code':
      return createBlock({ ...content, code: text }, block.anchor, block.id);
    case 'heading':
      return createBlock(
        { ...content, inlines: [{ type: 'text', text, marks: [] }] },
        block.anchor,
        block.id
      );
    default:
      return { ...plainBlock(block.kind, text, block.anchor), id: block.id };
  }
}
