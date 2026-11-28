/** @file Builds sources sources queries and mutations with bound store resources. */

import type { ContentSnapshotId, ProjectId, SourceId } from '@study/contracts';
import {
  StudyError,
  contentSnapshotIdSchema,
  correctBlockInputSchema,
  projectIdSchema,
  documentSchema,
  encodeBlockContent,
  hasTextualContent,
  setSourceProjectInputSchema,
  sourceIdSchema,
  sourcePageInputSchema,
  sourceProcessingSchema,
  sourceSchema,
  uploadedSourceOrigins
} from '@study/contracts';
import * as tables from '@study/db';
import { and, desc, eq, inArray, lt, or, sql } from '@study/db';
import { storeMutation, storeQuery, unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { CryptoHasher } from 'bun';
import { Option, Schema } from 'effect';

import { sourceDeletionBlockers } from './retention.ts';
import { checkedBytes, makeHelpers } from './rows.ts';
import { changeSchema, inputSchema, replacementSchema, request } from './schemas.ts';

function uploadedFor(project: ProjectId | null | undefined) {
  if (project === undefined) return undefined;

  const originals = inArray(tables.sources.origin, uploadedSourceOrigins);

  return project === null ? originals : and(originals, inProject(project));
}

function inProject(project: ProjectId) {
  const { sources, project_sources } = tables;

  return or(
    eq(sources.project_id, project),
    sql`EXISTS (
      SELECT 1 FROM ${project_sources}
      WHERE ${project_sources.source_id} = ${sources.id}
        AND ${project_sources.project_id} = ${project}
    )`
  );
}

export function makeSourceStore({ db, clock, timestampClock }: StoreResources) {
  const { selectSources, sourceRow, find, state, checkState } = makeHelpers({
    db,
    clock,
    timestampClock
  });

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
      belongsToProject: storeQuery({
        role: 'required',
        input: Schema.Struct({ id: sourceIdSchema, projectId: projectIdSchema }),
        output: Schema.Boolean,
        run: ({ id, projectId }) =>
          db.orm
            .select({ id: tables.sources.id })
            .from(tables.sources)
            .where(and(eq(tables.sources.id, id), inProject(projectId)))
            .get() !== undefined
      }),
      sources: storeQuery({
        role: 'collection',
        input: sourcePageInputSchema,
        output: Schema.Array(sourceSchema),
        run: (input) =>
          selectSources()
            .where(
              and(
                uploadedFor(input.uploadedFor),
                input.nameContains
                  ? sql`instr(lower(${tables.sources.name}), lower(${input.nameContains})) > 0`
                  : undefined,
                input.before === undefined ? undefined : lt(tables.sources.id, input.before),
                input.projectId === undefined
                  ? undefined
                  : eq(tables.sources.project_id, input.projectId)
              )
            )
            .orderBy(desc(tables.sources.id))
            .limit(input.limit)
            .all()
            .map(sourceRow)
      })
    },
    mutations: {
      createSource: storeMutation({
        changes: ['sources'],
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
              sha256: new CryptoHasher('sha256').update(bytes).digest(),
              created_at: unixSeconds(timestampClock)
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
        changes: ['sources'],
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
              sha256: new CryptoHasher('sha256').update(bytes).digest()
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
        changes: ['sources'],
        input: sourceIdSchema,
        output: Schema.Boolean,
        run: (id) => {
          if (sourceDeletionBlockers({ db }, id).length)
            throw new StudyError(
              'invalid_input',
              'Exact evidence or image assets retain this source'
            );

          db.orm
            .delete(tables.source_extraction_revisions)
            .where(eq(tables.source_extraction_revisions.source_id, id))
            .run();
          db.orm
            .delete(tables.content_snapshots)
            .where(eq(tables.content_snapshots.source_id, id))
            .run();

          db.orm.delete(tables.note_sources).where(eq(tables.note_sources.source_id, id)).run();

          return db.orm.delete(tables.sources).where(eq(tables.sources.id, id)).run().changes !== 0;
        }
      }),
      requestSourceProcessing: storeMutation({
        changes: ['sources'],
        input: changeSchema,
        output: sourceProcessingSchema,
        run: (input) => {
          checkState(input.id, input.expectedRevision);
          setProcessingRequest(input.id, input.requestId);

          return state(input.id)!;
        }
      }),
      setSourceProject: storeMutation({
        changes: ['sources'],
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

          db.orm
            .update(tables.sources)
            .set({ project_id: input.projectId })
            .where(eq(tables.sources.id, input.id))
            .run();

          return find(input.id)!;
        }
      }),
      requestCorrection: storeMutation({
        changes: ['sources'],
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
        changes: ['sources'],
        input: Schema.Struct({ ...changeSchema.fields, document: documentSchema }),
        output: Schema.Struct({ documentId: contentSnapshotIdSchema, published: Schema.Boolean }),
        run: (input) => {
          const current = checkState(input.id, input.expectedRevision, input.requestId);

          // An activity may retry after the document committed but before its checkpoint did.
          const publication = processingPublication(input.id);

          if (current.documentId !== null && publication?.requestId === input.requestId)
            return { documentId: current.documentId, published: false };

          const doc = input.document;

          if (!doc.blocks.some((block) => hasTextualContent(block.content)))
            throw new StudyError('invalid_input', 'Source extraction contains no readable content');

          for (const block of doc.blocks) {
            if (block.content.type !== 'image') continue;

            const asset = db.orm
              .select()
              .from(tables.source_snapshots)
              .where(
                and(
                  eq(tables.source_snapshots.source_id, block.content.sourceId),
                  eq(tables.source_snapshots.revision, BigInt(block.content.revision))
                )
              )
              .get();

            if (!asset || asset.kind !== 'image' || !asset.mime.toLowerCase().startsWith('image/'))
              throw new StudyError('invalid_input', 'Managed image revision is unavailable');
          }

          const id = db.orm
            .insert(tables.content_snapshots)
            .values({
              source_id: input.id,
              extractor: doc.meta
                .extractor as typeof tables.content_snapshots.$inferInsert.extractor,
              extractor_version: BigInt(doc.meta.extractorVersion),
              meta: JSON.stringify(doc.meta),
              created_at: unixSeconds(timestampClock)
            })
            .run().lastInsertRowid as ContentSnapshotId;

          doc.blocks.forEach((block, ordinal) =>
            db.orm
              .insert(tables.blocks)
              .values({
                document_id: id,
                ordinal: BigInt(ordinal),
                kind: block.kind,
                text: block.text,
                editing_id: block.id,
                content: encodeBlockContent(block.content),
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
                content_hash: new CryptoHasher('sha256').update(block.text).digest()
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
