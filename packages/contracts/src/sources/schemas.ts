import { Schema } from 'effect';

import {
  projectIdSchema,
  sourceIdSchema,
  documentIdSchema,
  materialVersionIdSchema
} from '../ids.ts';
import { sourceKinds } from './sniff.ts';

export const sourceSchema = Schema.Struct({
  id: sourceIdSchema,
  name: Schema.String,
  kind: Schema.Literals(sourceKinds),
  mime: Schema.String,
  origin: Schema.Literals(['attachment', 'import', 'note', 'recording', 'web']),
  projectId: Schema.NullOr(projectIdSchema),
  projectName: Schema.NullOr(Schema.String),
  sizeBytes: Schema.BigInt,
  sha256: Schema.Uint8Array,
  uri: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt
});

export type Source = typeof sourceSchema.Type;

const natural = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
);

const positive = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
);

/** Source text offsets are UTF-8 bytes, never editor text offsets. */
export const anchorSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('authored') }),
  Schema.Struct({ type: Schema.Literal('time'), startMs: natural, endMs: natural }).check(
    Schema.makeFilter((a) => a.endMs >= a.startMs)
  ),
  Schema.Struct({ type: Schema.Literal('page'), page: positive }),
  Schema.Struct({
    type: Schema.Literal('text'),
    lineStart: natural,
    lineEnd: natural,
    start: natural,
    end: natural
  }).check(Schema.makeFilter((a) => a.lineEnd >= a.lineStart && a.end >= a.start)),
  Schema.Struct({ type: Schema.Literals(['slide', 'paragraph']), index: natural }),
  Schema.Struct({
    type: Schema.Literal('url'),
    url: Schema.String.check(Schema.makeFilter(validUrl)),
    fragment: Schema.NullOr(Schema.String)
  })
]);

function validUrl(value: string) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const blockIdSchema = Schema.String.check(Schema.isBetweenLength(1, 128)).pipe(
  Schema.brand('BlockId')
);

export const blockKinds = [
  'paragraph',
  'heading',
  'list_item',
  'table',
  'code',
  'segment',
  'math',
  'image',
  'reference'
] as const;

const inlines = Schema.Array(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal('text'),
      text: Schema.String,
      marks: Schema.Array(
        Schema.Literals(['strong', 'emphasis', 'code', 'strike', 'subscript', 'superscript'])
      )
    }),
    Schema.Struct({
      type: Schema.Literal('link'),
      text: Schema.String,
      href: Schema.String.check(Schema.makeFilter(validUrl))
    }),
    Schema.Struct({ type: Schema.Literal('math'), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal('break') })
  ])
);

// List preorder retains nesting and per-item numbering, bounded to sixteen levels.
// Cells retain paragraph boundaries; nested source tables report an omission.
export const blockContentSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['paragraph', 'segment']), inlines }),
  Schema.Struct({
    type: Schema.Literal('heading'),
    level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
    inlines
  }),
  Schema.Struct({
    type: Schema.Literal('list_item'),
    items: Schema.Array(
      Schema.Struct({
        depth: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16 })),
        ordered: Schema.Boolean,
        continuation: Schema.optional(Schema.Boolean),
        start: positive,
        inlines
      })
    ).check(
      Schema.makeFilter((items) =>
        items.every((item, index) => item.depth <= (index === 0 ? 0 : items[index - 1]!.depth + 1))
      )
    )
  }),
  Schema.Struct({
    type: Schema.Literal('table'),
    rows: Schema.Array(
      Schema.Struct({
        cells: Schema.Array(
          Schema.Struct({ header: Schema.Boolean, paragraphs: Schema.Array(inlines) })
        )
      })
    )
  }),
  Schema.Struct({
    type: Schema.Literal('code'),
    code: Schema.String,
    language: Schema.NullOr(Schema.String)
  }),
  Schema.Struct({ type: Schema.Literal('math'), expression: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('image'),
    sourceId: sourceIdSchema,
    revision: positive,
    alt: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal('reference'),
    inlines,
    href: Schema.String.check(Schema.makeFilter(validUrl))
  })
]);

export type BlockContent = typeof blockContentSchema.Type;

export type Inline = (typeof inlines.Type)[number];

function inlineText(content: readonly Inline[]): string {
  return content.map((item) => (item.type === 'break' ? '\n' : item.text)).join('');
}

/** The sole search/evidence projection. Separators preserve empty cells. */
export function canonicalText(content: BlockContent): string {
  switch (content.type) {
    case 'paragraph':
    case 'heading':
    case 'segment':
    case 'reference':
      return inlineText(content.inlines);
    case 'list_item':
      return content.items.map((item) => inlineText(item.inlines)).join('\n');
    case 'table':
      return content.rows
        .map((row) =>
          row.cells.map((cell) => cell.paragraphs.map(inlineText).join('\n')).join(' | ')
        )
        .join('\n');
    case 'code':
      return content.code;
    case 'math':
      return content.expression;
    case 'image':
      return content.alt;
  }
}

const blockSchema = Schema.Struct({
  id: blockIdSchema,
  kind: Schema.Literals(blockKinds),
  content: blockContentSchema,
  text: Schema.String,
  anchor: anchorSchema
}).check(
  Schema.makeFilter(
    (block) => block.kind === block.content.type && block.text === canonicalText(block.content)
  )
);

const documentMetaSchema = Schema.Struct({
  extractor: Schema.NullOr(Schema.String),
  extractorVersion: natural,
  provider: Schema.NullOr(Schema.String),
  durationMs: Schema.NullOr(natural),
  pageCount: Schema.NullOr(natural),
  refiners: Schema.mutable(
    Schema.Array(Schema.Struct({ refiner: Schema.String, version: natural }))
  ),
  waitingFor: Schema.mutable(Schema.Array(Schema.String)),
  corrected: Schema.Boolean,
  omissions: Schema.mutable(
    Schema.Array(
      Schema.Literals([
        'formatting',
        'nested_table',
        'embedded_media',
        'layout',
        'provider_structure',
        'structure',
        'unsupported_markup'
      ])
    )
  )
});

const blocksSchema = Schema.mutable(Schema.Array(blockSchema)).check(
  Schema.makeFilter((blocks) => new Set(blocks.map((block) => block.id)).size === blocks.length)
);

export const documentSchema = Schema.Struct({
  blocks: blocksSchema,
  meta: documentMetaSchema
});

export const documentTextRangeSchema = Schema.Struct({
  versionId: materialVersionIdSchema,
  documentId: documentIdSchema,
  blockId: blockIdSchema,
  start: natural,
  end: natural
}).check(Schema.makeFilter((range) => range.end >= range.start));
