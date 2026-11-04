/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies shared session deletion fixtures and complete logical persistence marker  │
 * │ scans.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates captured sessions and reads retained library citations and annotation history. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the controlled provider fixture and native cleanup without replacing publication    │
 * │ guards.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { documentTransformOutputSchema } from '@study/contracts/ai/document-transform';
import type { StudyDocumentVersionId, SessionId } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import {
  sessionDeletionHandler,
  sessionDeletionWorkflow
} from '#server/features/conversations/workflows/deletion';
import { Documents } from '#server/features/documents/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import type { documentTransformFixture } from '#testing/document-transform';

type DeletionFixture = Awaited<ReturnType<typeof documentTransformFixture>>;

const meta = {
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

export function setup(
  fixture: DeletionFixture,
  marker: string,
  target = false,
  additionalInputVersionId?: StudyDocumentVersionId
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const chats = yield* Conversations;

      const documents = yield* Documents;

      const session = yield* chats.createUntitledSession({});

      const other = yield* chats.createSession({ title: 'Keep other session' });

      const library = yield* documents.create({
        createKey: randomUUID(),
        inputs: [],
        citations: [],
        title: 'Shared independent input',
        sessionId: session.id,
        document: { blocks: [paragraph('Independent library evidence')], meta }
      });

      assert.ok(library.version);
      yield* chats.postMessage({ sessionId: session.id, text: marker, requestReply: false });

      yield* chats.requestTitle({ sessionId: session.id });

      yield* chats.postMessage({
        sessionId: other.id,
        text: 'Other conversation',
        requestReply: false
      });

      yield* chats.updateSessionSelection({
        sessionId: session.id,
        expectedRevision: 0n,
        targets: [
          {
            input: { kind: 'document', versionId: library.version.id },
            scope: { kind: 'document' }
          },
          ...(additionalInputVersionId === undefined
            ? []
            : [
                {
                  input: { kind: 'document' as const, versionId: additionalInputVersionId },
                  scope: { kind: 'document' as const }
                }
              ])
        ]
      });

      if (additionalInputVersionId !== undefined) {
        const additional = yield* documents.version({ id: additionalInputVersionId });

        yield* documents.attach({ sessionId: session.id, documentId: additional.documentId });
      }

      const capture = yield* chats.captureSessionContext({
        sessionId: session.id,
        intentKey: 'delete-capture',
        instruction: marker + '-instruction',
        preferences: {}
      });

      const request = yield* chats.requestDocumentTransform({
        contextRequestId: capture.requestId,
        title: 'Generated result',
        operations: ['clarity'],
        ...(target ? { editTargetVersionId: library.version.id } : {})
      });

      const pending = yield* chats.requestReply({
        sessionId: session.id,
        intentKey: 'private-reply-capture',
        instruction: marker + '-reply',
        preferences: {}
      });

      return {
        session,
        other,
        library: { ...library, version: library.version },
        capture,
        request,
        pending
      };
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function deletionEvent(fixture: DeletionFixture, id: SessionId) {
  const row = fixture.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'SessionDeletionRequested'))
    .all()
    .at(-1);

  assert.ok(row);

  const event = decodeEvent(row.payload);

  assert.ok(event.type === 'SessionDeletionRequested');

  assert.strictEqual(event.sessionId, id);

  return event;
}

export function cleanup(fixture: DeletionFixture, id: SessionId) {
  const event = deletionEvent(fixture, id);

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(sessionDeletionWorkflow, sessionDeletionHandler);

        return yield* engine.execute(sessionDeletionWorkflow, {
          executionId: `cleanup/${event.eventId}`,
          payload: { event }
        });
      }).pipe(Effect.provide(fixture.services()))
    )
  );
}

export function assertScrubbed(
  fixture: DeletionFixture,
  marker: string,
  retainAuthoredMetadata = true
) {
  // Scan every logical application table, including full status, outbox and payload rows.
  // FTS shadow pages are physical index storage, not additional logical conversation records.
  const tables = fixture.context.db.orm.all<{ name: string }>(sql`
    SELECT name FROM sqlite_schema WHERE type='table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%'
    AND name != '__drizzle_migrations' ORDER BY name
  `);

  for (const table of tables) {
    const content = JSON.stringify(
      fixture.context.db.orm
        .all(sql.raw(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`))
        .map((row) => {
          if (!retainAuthoredMetadata) return row;
          // Authored versions and requests intentionally retain their instructions; session cleanup
          // removes raw captures, not independent document generation metadata.

          if (table.name === 'study_document_versions') return { ...row, instruction: null };

          if (table.name === 'study_document_transform_requests')
            return {
              ...row,
              instruction: null,
              request:
                typeof row.request === 'string'
                  ? JSON.stringify({ ...JSON.parse(row.request), instruction: null })
                  : row.request
            };

          return row;
        }),
      (_, value) => (typeof value === 'bigint' ? String(value) : value)
    );

    assert.ok(!content.includes(marker), `Session capture remains in ${table.name}`);
  }
}

/** Keep exact historic annotations on independently published versions through cleanup. */
export function annotateLibrary(fixture: DeletionFixture, ids: readonly StudyDocumentVersionId[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const documents = yield* Documents;

      for (const id of ids) {
        const version = yield* documents.version({ id });
        const block = version.document.blocks[0];

        assert.ok(block);

        const created = yield* documents.createAnnotation({
          target: {
            documentId: version.documentId,
            range: {
              versionId: id,
              snapshotId: version.snapshotId,
              blockId: block.id,
              start: 0,
              end: 1
            }
          },
          kind: 'note',
          note: 'Independent retained annotation'
        });

        assert.ok(created.outcome === 'saved');
      }
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function libraryState(fixture: DeletionFixture, ids: readonly StudyDocumentVersionId[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const documents = yield* Documents;

      const results = [];

      for (const id of ids) {
        const version = yield* documents.version({ id });

        const citations = version.citations;

        const annotations = yield* documents.annotations({
          documentId: version.documentId,
          includeDeleted: true,
          limit: 100
        });

        const histories = [];

        for (const annotation of annotations.items)
          histories.push(yield* documents.annotationHistory({ id: annotation.id, limit: 100 }));

        results.push({ version, citations, annotations, histories });
      }

      return results;
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function awaitNativeStatus(
  fixture: Awaited<ReturnType<typeof documentTransformFixture>>,
  id: string,
  status: 'running' | 'suspended' | 'completed' | 'cancelled'
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (workflowStore(fixture.context).execution(id)?.status === status) return;

      yield* Effect.sleep('5 millis');
    }

    assert.strictEqual(workflowStore(fixture.context).execution(id)?.status, status);
  });
}

export function validDocumentTransformOutput(
  text: string
): typeof documentTransformOutputSchema.Type {
  return {
    blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] }],
    notes: [
      {
        kind: 'limit',
        explanation: 'Uses only the selected independent evidence',
        blockOrdinals: [0]
      }
    ]
  };
}
