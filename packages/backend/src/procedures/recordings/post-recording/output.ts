import { Schema } from 'effect';

const nullableId = Schema.NullOr(Schema.BigInt);

const kind = Schema.Literals([
  'archive',
  'audio',
  'code',
  'document',
  'image',
  'link',
  'note',
  'other',
  'pdf',
  'slides',
  'spreadsheet',
  'text',
  'video',
  'web'
]);

const anchor = Schema.Union([
  Schema.Struct({ type: Schema.Literal('time'), startMs: Schema.Number, endMs: Schema.Number }),
  Schema.Struct({ type: Schema.Literal('page'), page: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal('text'),
    lineStart: Schema.Number,
    lineEnd: Schema.Number,
    start: Schema.Number,
    end: Schema.Number
  }),
  Schema.Struct({ type: Schema.Literals(['slide', 'paragraph']), index: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal('url'),
    url: Schema.String,
    fragment: Schema.NullOr(Schema.String)
  })
]);

const documentMeta = Schema.Struct({
  extractor: Schema.NullOr(Schema.String),
  extractorVersion: Schema.Number,
  provider: Schema.NullOr(Schema.String),
  durationMs: Schema.NullOr(Schema.Number),
  pageCount: Schema.NullOr(Schema.Number),
  refiners: Schema.mutable(
    Schema.Array(Schema.Struct({ refiner: Schema.String, version: Schema.Number }))
  ),
  waitingFor: Schema.mutable(Schema.Array(Schema.String)),
  corrected: Schema.Boolean
});

const document = Schema.Struct({
  id: Schema.BigInt,
  blocks: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(['paragraph', 'heading', 'list_item', 'table', 'code', 'segment']),
        text: Schema.String,
        anchor
      })
    )
  ),
  meta: documentMeta
});

const target = Schema.Union([
  Schema.Struct({ type: Schema.Literal('source'), id: Schema.BigInt }),
  Schema.Struct({ type: Schema.Literal('document'), id: Schema.BigInt }),
  Schema.Struct({ type: Schema.Literal('session'), id: Schema.BigInt }),
  Schema.Struct({ type: Schema.Literal('message'), id: Schema.BigInt }),
  Schema.Struct({ type: Schema.Literal('artifact'), id: Schema.BigInt }),
  Schema.Struct({ type: Schema.Literal('question'), id: Schema.BigInt })
]);

const job = Schema.Struct({
  id: Schema.BigInt,
  kind: Schema.Literals([
    'artifact',
    'extract',
    'fetch',
    'grade',
    'index',
    'question',
    'reply',
    'rewrite',
    'title'
  ]),
  target,
  status: Schema.Literals([
    'blocked',
    'cancelled',
    'failed',
    'queued',
    'running',
    'succeeded',
    'waiting'
  ]),
  args: Schema.MutableJson,
  attempts: Schema.BigInt,
  errorKind: Schema.NullOr(
    Schema.Literals([
      'auth',
      'cancelled',
      'config',
      'internal',
      'invalid_input',
      'model_unavailable',
      'not_enough',
      'not_found',
      'rate_limited',
      'transient',
      'unsupported'
    ])
  ),
  error: Schema.NullOr(Schema.String),
  runAfter: Schema.BigInt,
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt,
  startedAt: Schema.NullOr(Schema.BigInt),
  finishedAt: Schema.NullOr(Schema.BigInt)
});

const part = Schema.Struct({
  id: Schema.BigInt,
  sourceId: nullableId,
  sourceName: Schema.String,
  sourceKind: kind,
  content: Schema.Struct({ sourceId: nullableId, name: Schema.String, kind }),
  document: Schema.NullOr(document),
  jobs: Schema.mutable(Schema.Array(job)),
  thread: Schema.Struct({ replies: Schema.BigInt, lastReplyAt: Schema.NullOr(Schema.BigInt) })
});

const version = Schema.Struct({
  id: Schema.BigInt,
  number: Schema.BigInt,
  origin: Schema.Literals(['answer', 'edited', 'improve', 'instruction', 'summarize', 'typed']),
  status: Schema.Literals(['complete', 'pending', 'writing']),
  text: Schema.String,
  basedOn: nullableId,
  instruction: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt
});

const citation = Schema.Struct({
  marker: Schema.Number,
  sourceId: nullableId,
  sourceName: Schema.String,
  anchor,
  quote: Schema.String
});

const reply = Schema.NullOr(job);

export const outputSchema = Schema.Struct({
  id: Schema.BigInt,
  sessionId: Schema.BigInt,
  role: Schema.Literals(['assistant', 'user']),
  threadRoot: nullableId,
  replyTo: nullableId,
  activeVersionId: nullableId,
  recordingId: nullableId,
  recordingMs: nullableId,
  recordedIn: nullableId,
  createdAt: Schema.BigInt,
  versions: Schema.mutable(Schema.Array(version)),
  parts: Schema.mutable(Schema.Array(part)),
  citations: Schema.mutable(Schema.Array(citation)),
  status: Schema.Literals(['complete', 'pending', 'writing']),
  activeVersion: nullableId,
  reply
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
