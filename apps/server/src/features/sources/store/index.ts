import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import { documentIdSchema, projectIdSchema, sourceIdSchema } from '@study/contracts/ids';
import type { SourceId, DocumentId } from '@study/contracts/ids';
import {
  correctBlockInputSchema,
  setSourceProjectInputSchema,
  sourceExportSchema,
  sourcePageInputSchema,
  sourceProcessingSchema,
  sourceRevisionSchema
} from '@study/contracts/sources/rpc';
import { documentSchema, sourceSchema } from '@study/contracts/sources/schemas';
import { MAX_SOURCE_BYTES, sourceKindSchema } from '@study/contracts/sources/sniff';
import { and, desc, eq, getTableColumns, lt } from '@study/db';
import * as tables from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

const revision = sourceRevisionSchema;

const request = Schema.String.check(Schema.isMinLength(1));

const bytesSchema = Schema.Uint8Array;

const inputSchema = Schema.Struct({
  name: Schema.String,
  kind: sourceKindSchema,
  mime: Schema.String,
  origin: Schema.Literals(['attachment', 'import', 'note', 'recording', 'web']),
  projectId: Schema.NullOr(projectIdSchema),
  uri: Schema.NullOr(Schema.String),
  bytes: bytesSchema,
  requestId: request
});

const changeSchema = Schema.Struct({
  id: sourceIdSchema,
  expectedRevision: revision,
  requestId: request
});

const replacementSchema = Schema.Struct({
  ...changeSchema.fields,
  bytes: bytesSchema,
  name: Schema.optional(Schema.String),
  kind: Schema.optional(sourceKindSchema),
  mime: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.NullOr(Schema.String))
});

const snapshotKey = Schema.Struct({ id: sourceIdSchema, revision });

const snapshotSchema = Schema.Struct({
  revision,
  bytes: bytesSchema,
  kind: sourceKindSchema,
  mime: Schema.String,
  uri: Schema.NullOr(Schema.String)
});

function makeHelpers({ db }: StoreResources) {
  function selectSources() {
    return db.orm
      .select({ ...getTableColumns(tables.sources), project_name: tables.projects.name })
      .from(tables.sources)
      .leftJoin(tables.projects, eq(tables.projects.id, tables.sources.project_id));
  }

  function sourceRow(row: ReturnType<ReturnType<typeof selectSources>['all']>[number]) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      mime: row.mime,
      origin: row.origin,
      projectId: row.project_id,
      projectName: row.project_name,
      sizeBytes: row.size_bytes,
      sha256: new Uint8Array(row.sha256),
      uri: row.uri,
      createdAt: row.created_at
    };
  }

  function find(id: SourceId) {
    const row = selectSources().where(eq(tables.sources.id, id)).get();

    return row ? sourceRow(row) : null;
  }

  function state(id: SourceId) {
    const row = db.orm
      .select()
      .from(tables.source_processing)
      .where(eq(tables.source_processing.source_id, id))
      .get();

    return row
      ? {
          sourceId: id,
          revision: Number(row.revision),
          requestId: row.request_id,
          documentId: row.document_id
        }
      : null;
  }

  function checkState(id: SourceId, expectedRevision: number, requestId?: string) {
    const current = state(id);

    if (!current) throw new StudyError('not_found', 'source processing not found');

    if (
      current.revision !== expectedRevision ||
      (requestId !== undefined && current.requestId !== requestId)
    )
      throw new StudyError('invalid_input', 'source processing is stale');

    return current;
  }

  function readDocument(row: { id: DocumentId; meta: string }) {
    const blocks = db.orm
      .select({
        kind: tables.blocks.kind,
        text: tables.blocks.text,
        anchor: tables.blocks.anchor
      })
      .from(tables.blocks)
      .where(eq(tables.blocks.document_id, row.id))
      .orderBy(tables.blocks.ordinal)
      .all()
      .map((block) => ({ ...block, anchor: JSON.parse(block.anchor) }));

    return {
      id: row.id,
      document: Schema.decodeUnknownSync(documentSchema)({ meta: JSON.parse(row.meta), blocks })
    };
  }

  return { selectSources, sourceRow, find, state, checkState, readDocument };
}

function checkedBytes(value: Uint8Array) {
  if (!value.byteLength || value.byteLength > MAX_SOURCE_BYTES)
    throw new StudyError('invalid_input', 'source size is outside the allowed range');

  return Buffer.from(value);
}

export const SourceStore = defineStore({
  name: 'study/SourceStore',
  entity: { singular: 'source', plural: 'sources' },
  make: ({ db, clock }) => {
    const { selectSources, sourceRow, find, state, checkState } = makeHelpers({ db, clock });

    function documentVersionReferences() {
      return db.orm
        .select({
          id: tables.material_document_versions.version_id,
          projectId: tables.material_versions.project_id
        })
        .from(tables.material_document_versions)
        .innerJoin(
          tables.documents,
          eq(tables.documents.id, tables.material_document_versions.document_id)
        )
        .innerJoin(
          tables.material_versions,
          eq(tables.material_versions.id, tables.material_document_versions.version_id)
        );
    }

    function setProcessingRequest(id: SourceId, requestId: string) {
      db.orm
        .update(tables.source_processing)
        .set({ request_id: requestId })
        .where(eq(tables.source_processing.source_id, id))
        .run();
    }

    function processingPublication(id: SourceId) {
      return db.orm
        .select({ requestId: tables.source_processing.published_request_id })
        .from(tables.source_processing)
        .where(eq(tables.source_processing.source_id, id))
        .get();
    }

    return {
      queries: {
        source: storeQuery({
          role: 'required',
          input: sourceIdSchema,
          output: sourceSchema,
          run: (id) => find(id)!
        }),
        findSource: storeQuery({
          role: 'optional',
          input: sourceIdSchema,
          output: Schema.Option(sourceSchema),
          run: (id) => Option.fromNullishOr(find(id))
        }),
        sources: storeQuery({
          role: 'collection',
          input: sourcePageInputSchema,
          output: Schema.Array(sourceSchema),
          run: (input) =>
            selectSources()
              .where(input.before === undefined ? undefined : lt(tables.sources.id, input.before))
              .orderBy(desc(tables.sources.id))
              .limit(input.limit)
              .all()
              .map(sourceRow)
        })
      },
      mutations: {
        createSource: storeMutation({
          input: inputSchema,
          output: sourceSchema,
          run: (input) => {
            const bytes = checkedBytes(input.bytes);
            const name = input.name.trim();

            if (!name) throw new StudyError('invalid_input', 'a source needs a name');

            const id = db.orm
              .insert(tables.sources)
              .values({
                name,
                kind: input.kind,
                mime: input.mime,
                origin: input.origin,
                project_id: input.projectId,
                uri: input.uri,
                size_bytes: BigInt(bytes.length),
                sha256: createHash('sha256').update(bytes).digest(),
                created_at: unixSeconds(clock)
              })
              .run().lastInsertRowid as SourceId;

            db.orm.insert(tables.source_blobs).values({ source_id: id, bytes }).run();
            db.orm
              .insert(tables.source_processing)
              .values({ source_id: id, revision: 1n, request_id: input.requestId })
              .run();
            db.orm
              .insert(tables.source_snapshots)
              .values({
                source_id: id,
                revision: 1n,
                bytes,
                kind: input.kind,
                mime: input.mime,
                uri: input.uri
              })
              .run();

            return find(id)!;
          }
        }),
        replaceSourceInput: storeMutation({
          input: replacementSchema,
          output: sourceProcessingSchema,
          run: (input) => {
            checkState(input.id, input.expectedRevision);
            const bytes = checkedBytes(input.bytes);

            if (
              !Number.isSafeInteger(input.expectedRevision) ||
              input.expectedRevision >= Number.MAX_SAFE_INTEGER
            )
              throw new StudyError('invalid_input', 'source revision cannot be incremented');

            const next = BigInt(input.expectedRevision) + 1n;

            if (input.name !== undefined && !input.name.trim())
              throw new StudyError('invalid_input', 'a source needs a name');

            db.orm
              .update(tables.sources)
              .set({
                name: input.name?.trim(),
                kind: input.kind,
                mime: input.mime,
                uri: input.uri,
                size_bytes: BigInt(bytes.length),
                sha256: createHash('sha256').update(bytes).digest()
              })
              .where(eq(tables.sources.id, input.id))
              .run();
            db.orm
              .update(tables.source_blobs)
              .set({ bytes })
              .where(eq(tables.source_blobs.source_id, input.id))
              .run();
            const updated = find(input.id)!;

            db.orm
              .insert(tables.source_snapshots)
              .values({
                source_id: input.id,
                revision: next,
                bytes,
                kind: updated.kind,
                mime: updated.mime,
                uri: updated.uri
              })
              .run();
            db.orm
              .update(tables.source_processing)
              .set({ revision: next, request_id: input.requestId })
              .where(eq(tables.source_processing.source_id, input.id))
              .run();

            return state(input.id)!;
          }
        }),
        deleteSource: storeMutation({
          input: sourceIdSchema,
          output: Schema.Boolean,
          run: (id) => {
            for (const table of [
              tables.material_file_versions,
              tables.material_audio_versions,
              tables.material_video_versions,
              tables.material_image_versions,
              tables.material_link_versions
            ]) {
              const published = db.orm
                .select({ id: table.version_id })
                .from(table)
                .innerJoin(
                  tables.material_versions,
                  eq(tables.material_versions.id, table.version_id)
                )
                .where(
                  and(eq(table.source_id, id), eq(tables.material_versions.status, 'published'))
                )
                .get();

              if (published)
                throw new StudyError('invalid_input', 'Published source content is immutable');
            }

            const publishedDocument = documentVersionReferences()
              .where(
                and(
                  eq(tables.documents.source_id, id),
                  eq(tables.material_versions.status, 'published')
                )
              )
              .get();

            if (publishedDocument)
              throw new StudyError('invalid_input', 'Published source content is immutable');

            return (
              db.orm.delete(tables.sources).where(eq(tables.sources.id, id)).run().changes !== 0n
            );
          }
        }),
        requestSourceProcessing: storeMutation({
          input: changeSchema,
          output: sourceProcessingSchema,
          run: (input) => {
            checkState(input.id, input.expectedRevision);
            setProcessingRequest(input.id, input.requestId);

            return state(input.id)!;
          }
        }),
        setSourceProject: storeMutation({
          input: setSourceProjectInputSchema,
          output: sourceSchema,
          run: (input) => {
            const source = find(input.id);

            if (!source) throw new StudyError('not_found', 'source not found');

            if (source.projectId === input.projectId) return source;

            if (
              input.projectId !== null &&
              !db.orm
                .select({ id: tables.projects.id })
                .from(tables.projects)
                .where(eq(tables.projects.id, input.projectId))
                .get()
            )
              throw new StudyError('not_found', 'project not found');

            for (const table of [
              tables.material_file_versions,
              tables.material_audio_versions,
              tables.material_video_versions,
              tables.material_image_versions,
              tables.material_link_versions
            ]) {
              const refs = db.orm
                .select({ projectId: tables.material_versions.project_id })
                .from(table)
                .innerJoin(
                  tables.material_versions,
                  eq(tables.material_versions.id, table.version_id)
                )
                .where(eq(table.source_id, input.id))
                .all();

              if (refs.some((ref) => ref.projectId !== input.projectId))
                throw new StudyError('invalid_input', 'material source ownership is immutable');
            }

            const refs = documentVersionReferences()
              .where(eq(tables.documents.source_id, input.id))
              .all();
            const attachments = db.orm
              .select({ projectId: tables.sessions.project_id })
              .from(tables.message_parts)
              .innerJoin(tables.messages, eq(tables.messages.id, tables.message_parts.message_id))
              .innerJoin(tables.sessions, eq(tables.sessions.id, tables.messages.session_id))
              .where(eq(tables.message_parts.source_id, input.id))
              .all();

            if (
              refs.some((ref) => ref.projectId !== input.projectId) ||
              attachments.some((ref) => ref.projectId !== input.projectId)
            )
              throw new StudyError(
                'invalid_input',
                'source ownership is incompatible with existing references'
              );

            db.orm
              .update(tables.sources)
              .set({ project_id: input.projectId })
              .where(eq(tables.sources.id, input.id))
              .run();

            return find(input.id)!;
          }
        }),
        requestCorrection: storeMutation({
          input: Schema.Struct({ ...correctBlockInputSchema.fields, requestId: request }),
          output: sourceProcessingSchema,
          run: (input) => {
            const current = state(input.id);

            if (!current || current.documentId !== input.documentId)
              throw new StudyError('invalid_input', 'source document is stale');

            const publication = processingPublication(input.id);

            if (current.requestId === null || publication?.requestId !== current.requestId)
              throw new StudyError('invalid_input', 'source processing is pending');

            const block = db.orm
              .select({ text: tables.blocks.text })
              .from(tables.blocks)
              .where(
                and(
                  eq(tables.blocks.document_id, input.documentId),
                  eq(tables.blocks.ordinal, BigInt(input.ordinal))
                )
              )
              .get();

            if (!block || block.text !== input.before)
              throw new StudyError('invalid_input', 'source block is stale');

            setProcessingRequest(input.id, input.requestId);

            return state(input.id)!;
          }
        }),
        publishSourceDocument: storeMutation({
          input: Schema.Struct({ ...changeSchema.fields, document: documentSchema }),
          output: Schema.Struct({ documentId: documentIdSchema, published: Schema.Boolean }),
          run: (input) => {
            const current = checkState(input.id, input.expectedRevision, input.requestId);

            // An activity may retry after the document committed but before its checkpoint did.
            const publication = processingPublication(input.id);

            if (current.documentId !== null && publication?.requestId === input.requestId)
              return { documentId: current.documentId, published: false };

            const doc = input.document;
            const id = db.orm
              .insert(tables.documents)
              .values({
                source_id: input.id,
                extractor: doc.meta.extractor as typeof tables.documents.$inferInsert.extractor,
                extractor_version: BigInt(doc.meta.extractorVersion),
                meta: JSON.stringify(doc.meta),
                created_at: unixSeconds(clock)
              })
              .run().lastInsertRowid as DocumentId;

            doc.blocks.forEach((block, ordinal) =>
              db.orm
                .insert(tables.blocks)
                .values({
                  document_id: id,
                  ordinal: BigInt(ordinal),
                  kind: block.kind,
                  text: block.text,
                  anchor: JSON.stringify(block.anchor)
                })
                .run()
            );
            let ordinal = 0n;

            doc.blocks.forEach((block, index) => {
              if (!block.text.trim()) return;

              db.orm
                .insert(tables.chunks)
                .values({
                  document_id: id,
                  ordinal: ordinal++,
                  first_block: BigInt(index),
                  last_block: BigInt(index),
                  anchor: JSON.stringify(block.anchor),
                  text: block.text,
                  content_hash: createHash('sha256').update(block.text).digest()
                })
                .run();
            });
            db.orm
              .update(tables.source_processing)
              .set({ document_id: id, published_request_id: input.requestId })
              .where(eq(tables.source_processing.source_id, input.id))
              .run();

            return { documentId: id, published: true };
          }
        })
      }
    };
  }
});

export const SourceExportStore = defineStore({
  name: 'study/SourceExportStore',
  entity: { singular: 'sourceExport', plural: 'sourceExports' },
  make: ({ db, clock }) => {
    const { find } = makeHelpers({ db, clock });

    return {
      queries: {
        sourceExport: storeQuery({
          role: 'required',
          input: sourceIdSchema,
          output: sourceExportSchema,
          run: (id) => {
            const source = find(id);
            const blob = db.orm
              .select()
              .from(tables.source_blobs)
              .where(eq(tables.source_blobs.source_id, id))
              .get();

            return source && blob ? { source, bytes: new Uint8Array(blob.bytes) } : null;
          }
        })
      },
      mutations: {}
    };
  }
});

export const SourceProcessingStore = defineStore({
  name: 'study/SourceProcessingStore',
  entity: { singular: 'sourceProcessing', plural: 'sourceProcessings' },
  make: ({ db, clock }) => {
    const { state } = makeHelpers({ db, clock });

    return {
      queries: {
        sourceProcessing: storeQuery({
          role: 'required',
          input: sourceIdSchema,
          output: sourceProcessingSchema,
          run: (id) => state(id)!
        }),
        findSourceProcessing: storeQuery({
          role: 'optional',
          input: sourceIdSchema,
          output: Schema.Option(sourceProcessingSchema),
          run: (id) => Option.fromNullishOr(state(id))
        })
      },
      mutations: {}
    };
  }
});

export const SourceSnapshotStore = defineStore({
  name: 'study/SourceSnapshotStore',
  entity: { singular: 'sourceSnapshot', plural: 'sourceSnapshots' },
  make: ({ db }) => ({
    queries: {
      sourceSnapshot: storeQuery({
        role: 'required',
        input: snapshotKey,
        output: snapshotSchema,
        run: (input) => {
          const row = db.orm
            .select()
            .from(tables.source_snapshots)
            .where(
              and(
                eq(tables.source_snapshots.source_id, input.id),
                eq(tables.source_snapshots.revision, BigInt(input.revision))
              )
            )
            .get();

          return row
            ? {
                revision: Number(row.revision),
                bytes: new Uint8Array(row.bytes),
                kind: row.kind,
                mime: row.mime,
                uri: row.uri
              }
            : null;
        }
      })
    },
    mutations: {}
  })
});

export const SourceDocumentStore = defineStore({
  name: 'study/SourceDocumentStore',
  entity: { singular: 'sourceDocument', plural: 'sourceDocuments' },
  make: ({ db, clock }) => {
    const { readDocument } = makeHelpers({ db, clock });

    return {
      queries: {
        sourceDocument: storeQuery({
          role: 'required',
          input: sourceIdSchema,
          output: Schema.Struct({ id: documentIdSchema, document: documentSchema }),
          run: (sourceId) => {
            const row = db.orm
              .select({ id: tables.documents.id, meta: tables.documents.meta })
              .from(tables.source_processing)
              .innerJoin(
                tables.documents,
                eq(tables.documents.id, tables.source_processing.document_id)
              )
              .where(eq(tables.source_processing.source_id, sourceId))
              .get();

            if (!row) return null;

            return readDocument(row);
          }
        })
      },
      mutations: {}
    };
  }
});

export const HistoricalDocumentStore = defineStore({
  name: 'study/SourceHistoricalDocumentStore',
  entity: { singular: 'document', plural: 'documents' },
  make: ({ db, clock }) => {
    const { readDocument } = makeHelpers({ db, clock });

    return {
      queries: {
        document: storeQuery({
          role: 'required',
          input: Schema.Struct({
            id: documentIdSchema,
            sourceId: sourceIdSchema,
            projectId: projectIdSchema
          }),
          output: Schema.Struct({ id: documentIdSchema, document: documentSchema }),
          run: (input) => {
            const row = db.orm
              .select({ id: tables.documents.id, meta: tables.documents.meta })
              .from(tables.documents)
              .innerJoin(tables.sources, eq(tables.sources.id, tables.documents.source_id))
              .where(
                and(
                  eq(tables.documents.id, input.id),
                  eq(tables.sources.id, input.sourceId),
                  eq(tables.sources.project_id, input.projectId)
                )
              )
              .get();

            return row ? readDocument(row) : null;
          }
        })
      },
      mutations: {}
    };
  }
});

export const SourceFailureNoticeStore = defineStore({
  name: 'study/SourceFailureNoticeStore',
  entity: { singular: 'sourceFailureNotice', plural: 'sourceFailureNotices' },
  make: ({ db }) => ({
    queries: {
      sourceFailureNotice: storeQuery({
        role: 'required',
        input: Schema.String,
        output: Schema.Boolean,
        run: (id) =>
          Boolean(
            db.orm
              .select()
              .from(tables.workflowEvents)
              .where(eq(tables.workflowEvents.eventId, id))
              .get()
          )
      })
    },
    mutations: {}
  })
});
