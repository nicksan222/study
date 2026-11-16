/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Plans bounded ordered views retaining canonical document text and identity.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates scope, references, Unicode ranges and explicit processing budgets.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native workflow Activities persist accepted plans; features supply exact input versions. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import { validBlockTextRange } from '@study/contracts';
import type { Block, Document } from '@study/contracts';
import { anchorSchema, blockIdSchema, documentSchema } from '@study/contracts';
import { Effect, Schema } from 'effect';

const positive = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
);

const natural = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
);

const sourcePlanLimitsSchema = Schema.Struct({
  maxPieceChars: positive,
  maxPassageChars: positive,
  maxPieceBytes: positive,
  maxPlanChars: positive,
  maxPlanBytes: positive,
  maxPieces: positive
}).check(Schema.makeFilter((l) => l.maxPassageChars <= l.maxPieceChars));

export type SourcePlanLimits = typeof sourcePlanLimitsSchema.Type;

export const defaultSourcePlanLimits: SourcePlanLimits = {
  maxPassageChars: 1000,
  maxPieceChars: 16_000,
  maxPieceBytes: 60_000,
  maxPlanChars: 1_000_000,
  maxPlanBytes: 8_000_000,
  maxPieces: 128
};

const sourceSelectionSchema = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('complete') }),
  Schema.Struct({
    mode: Schema.Literal('selected'),
    ranges: Schema.Array(
      Schema.Struct({
        documentKey: Schema.String,
        blockId: blockIdSchema,
        start: natural,
        end: natural
      })
    )
  })
]);

export type SourceSelection = typeof sourceSelectionSchema.Type;

export interface SourceInput<Ref> {
  readonly key: string;
  readonly name: string;
  readonly reference: Ref;
  readonly document: Document;
}

function passageGroupSchema<Ref>(referenceSchema: Schema.Codec<Ref, unknown>) {
  return Schema.Struct({
    index: natural,
    passages: Schema.Array(
      Schema.Struct({
        marker: positive,
        documentKey: Schema.String,
        name: Schema.String,
        reference: referenceSchema,
        blockId: blockIdSchema,
        ordinal: natural,
        anchor: anchorSchema,
        start: natural,
        end: natural,
        text: Schema.String
      })
    )
  });
}

export type SourcePassageGroup<Ref> = ReturnType<typeof passageGroupSchema<Ref>>['Type'];

function planShape<Ref>(referenceSchema: Schema.Codec<Ref, unknown>) {
  return Schema.Struct({
    version: Schema.Literal(1),
    limits: sourcePlanLimitsSchema,
    selection: sourceSelectionSchema,
    pieces: Schema.Array(passageGroupSchema(referenceSchema))
  });
}

export function sourcePassagePlanSchema<Ref>(referenceSchema: Schema.Codec<Ref, unknown>) {
  return planShape(referenceSchema).check(
    Schema.makeFilter((plan) => validPlan(plan, referenceSchema))
  );
}

function validPlan<Ref>(
  plan: ReturnType<typeof planShape<Ref>>['Type'],
  referenceSchema: Schema.Codec<Ref, unknown>
) {
  const { limits, pieces } = plan;

  if (!pieces.length || pieces.length > limits.maxPieces) return false;

  let chars = 0,
    marker = 1;

  for (const [index, piece] of pieces.entries()) {
    if (!validPiece(piece, index, marker, limits, referenceSchema)) return false;

    marker += piece.passages.length;
    chars += piece.passages.reduce((sum, p) => sum + p.text.length, 0);
  }

  return (
    chars <= limits.maxPlanChars &&
    encodedBytes(planShape(referenceSchema), plan) <= limits.maxPlanBytes
  );
}

function validPiece<Ref>(
  piece: SourcePassageGroup<Ref>,
  index: number,
  marker: number,
  limits: SourcePlanLimits,
  referenceSchema: Schema.Codec<Ref, unknown>
) {
  if (piece.index !== index || !piece.passages.length) return false;

  if (encodedBytes(passageGroupSchema(referenceSchema), piece) > limits.maxPieceBytes) return false;

  if (piece.passages.reduce((sum, p) => sum + p.text.length, 0) > limits.maxPieceChars)
    return false;

  return piece.passages.every(
    (passage, offset) => passage.marker === marker + offset && validPassage(passage, limits)
  );
}

function validPassage<Ref>(
  passage: SourcePassageGroup<Ref>['passages'][number],
  limits: SourcePlanLimits
) {
  return (
    passage.end - passage.start === passage.text.length &&
    passage.text.length <= limits.maxPassageChars
  );
}

export type SourcePassagePlan<Ref> = ReturnType<typeof sourcePassagePlanSchema<Ref>>['Type'];

export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function invalid(message: string): never {
  throw new StudyError('invalid_input', message);
}

function exhausted(): never {
  throw new StudyError('not_enough', 'Context preparation scope exceeds the declared budget');
}

function safeEnd(text: string, start: number, end: number) {
  if (
    end < text.length &&
    end > start &&
    /[\uD800-\uDBFF]/.test(text[end - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[end]!)
  )
    return end - 1;

  return end;
}

export function planSourcePassages<Ref>(options: {
  readonly documents: readonly SourceInput<Ref>[];
  readonly referenceSchema: Schema.Codec<Ref, unknown>;
  readonly limits?: SourcePlanLimits;
  readonly selection: SourceSelection;
}) {
  return Effect.try({
    try: () => {
      const limits = Schema.decodeUnknownSync(sourcePlanLimitsSchema)(
        options.limits ?? defaultSourcePlanLimits
      );
      const selection = Schema.decodeUnknownSync(sourceSelectionSchema)(options.selection);

      validateDocuments(options.documents, options.referenceSchema);
      const selected = validateSelection(selection, options.documents);
      const builder = createPieceBuilder<Ref>(limits, options.referenceSchema);

      for (const input of options.documents) {
        input.document.blocks.forEach((block, ordinal) => {
          const ranges = selected
            ? selected
                .filter((r) => r.documentKey === input.key && r.blockId === block.id)
                .sort((a, b) => a.start - b.start)
            : [{ start: 0, end: block.text.length }];

          for (const range of ranges) builder.add(input, block, ordinal, range);
        });
      }

      const pieces = builder.finish();

      if (!pieces.length) invalid('Context preparation scope is empty');

      const plan = { version: 1 as const, limits, selection, pieces };

      if (
        encodedBytes(planShape(options.referenceSchema), { ...plan, version: 1 }) >
        limits.maxPlanBytes
      )
        exhausted();

      return Schema.decodeUnknownSync(
        Schema.toType(sourcePassagePlanSchema(options.referenceSchema))
      )(plan);
    },
    catch: (cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('invalid_input', 'Context preparation plan is invalid', { cause })
  });
}

/** Canonical UTF-16 ranges never separate a surrogate pair. */
export function splitTextRanges(
  text: string,
  maxChars: number
): readonly { start: number; end: number }[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1)
    invalid('Text range limit must be a positive safe integer');

  const ranges: { start: number; end: number }[] = [];
  let start = 0;

  do {
    const end = safeEnd(text, start, Math.min(text.length, start + maxChars));

    if (start < text.length && end === start) exhausted();

    ranges.push({ start, end });
    start = end;
  } while (start < text.length);

  return ranges;
}

function createPieceBuilder<Ref>(
  limits: SourcePlanLimits,
  referenceSchema: Schema.Codec<Ref, unknown>
) {
  const pieceSchema = passageGroupSchema(referenceSchema);
  const pieces: { index: number; passages: SourcePassageGroup<Ref>['passages'][number][] }[] = [];
  let current: { index: number; passages: SourcePassageGroup<Ref>['passages'][number][] } = {
    index: 0,
    passages: []
  };
  let chars = 0,
    pieceChars = 0,
    marker = 1;
  const flush = () => {
    if (!current.passages.length) return;

    pieces.push(current);

    if (pieces.length > limits.maxPieces) exhausted();

    current = { index: pieces.length, passages: [] };
    pieceChars = 0;
  };
  const append = (
    input: SourceInput<Ref>,
    block: Block,
    ordinal: number,
    range: { start: number; end: number }
  ) => {
    let start = range.start;
    let empty = start === range.end;

    while (start < range.end || empty) {
      if (pieceChars === limits.maxPieceChars) flush();

      const passage = (end: number) => ({
        marker,
        documentKey: input.key,
        name: input.name,
        reference: input.reference,
        blockId: block.id,
        ordinal,
        anchor: block.anchor,
        start,
        end,
        text: block.text.slice(start, end)
      });
      let end = safeEnd(
        block.text,
        start,
        Math.min(range.end, start + limits.maxPieceChars - pieceChars)
      );
      const fits = (offset: number) =>
        encodedBytes(pieceSchema, {
          ...current,
          passages: [...current.passages, passage(offset)]
        }) <= limits.maxPieceBytes;

      if ((end === start && !empty) || !fits(end)) {
        if (current.passages.length) {
          flush();
          continue;
        }

        end = fitEmptyPiece(block.text, start, end, empty, fits);
      }

      const part = passage(end);

      current.passages.push(part);
      marker++;
      chars += part.text.length;
      pieceChars += part.text.length;

      if (chars > limits.maxPlanChars) exhausted();

      start = end;
      empty = false;
    }
  };

  return {
    add(
      input: SourceInput<Ref>,
      block: Block,
      ordinal: number,
      range: { start: number; end: number }
    ) {
      if (chars + range.end - range.start > limits.maxPlanChars) exhausted();

      const text = block.text.slice(range.start, range.end);

      for (const part of splitTextRanges(text, limits.maxPassageChars))
        append(input, block, ordinal, {
          start: range.start + part.start,
          end: range.start + part.end
        });
    },
    finish() {
      flush();

      return pieces;
    }
  };
}

function fitTextEnd(text: string, start: number, end: number, fits: (end: number) => boolean) {
  const boundaries = [start];
  let offset = start;

  // UTF-16 prefixes inside a pair serialize as escaped surrogates and break byte monotonicity.
  for (const point of text.slice(start, end)) {
    offset += point.length;
    boundaries.push(offset);
  }

  let low = 0,
    high = boundaries.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if (fits(boundaries[mid]!)) low = mid;
    else high = mid - 1;
  }

  return boundaries[low]!;
}

function encodedBytes<A>(schema: Schema.Codec<A, unknown>, value: A) {
  return serializedBytes(Schema.encodeSync(Schema.toCodecJson(schema))(value));
}

function validateDocuments<Ref>(
  documents: readonly SourceInput<Ref>[],
  referenceSchema: Schema.Codec<Ref, unknown>
) {
  if (!documents.length) invalid('Context preparation requires input');

  const keys = new Set<string>();

  for (const input of documents) {
    if (!input.key || keys.has(input.key)) invalid('Document keys must be unique and nonempty');

    keys.add(input.key);
    Schema.decodeUnknownSync(documentSchema)(input.document);
    Schema.decodeUnknownSync(Schema.toType(referenceSchema))(input.reference);
  }
}

function validateSelection<Ref>(
  selection: SourceSelection,
  documents: readonly SourceInput<Ref>[]
) {
  if (selection.mode === 'complete') return null;

  if (!selection.ranges.length) invalid('Selected processing requires explicit ranges');

  const ranges = [...selection.ranges];

  for (const [index, range] of ranges.entries()) {
    const input = documents.find((d) => d.key === range.documentKey);

    if (!input || !validSelectionRange(input.document, range)) invalid('Selected range is invalid');

    if (ranges.slice(0, index).some((prior) => rangesOverlap(prior, range)))
      invalid('Selected ranges overlap');
  }

  return ranges;
}

type SelectedRange = Extract<SourceSelection, { mode: 'selected' }>['ranges'][number];

function validSelectionRange(document: Document, range: SelectedRange) {
  return range.end > range.start && validBlockTextRange(document, range);
}

function rangesOverlap(prior: SelectedRange, range: SelectedRange) {
  return (
    prior.documentKey === range.documentKey &&
    prior.blockId === range.blockId &&
    prior.start < range.end &&
    range.start < prior.end
  );
}

function fitEmptyPiece(
  text: string,
  start: number,
  end: number,
  empty: boolean,
  fits: (end: number) => boolean
) {
  const fitted = safeEnd(text, start, fitTextEnd(text, start, end, fits));

  if ((!empty && fitted === start) || !fits(fitted)) exhausted();

  return fitted;
}
