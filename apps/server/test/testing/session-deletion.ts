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

import assert from 'node:assert/strict';

import type { MaterialVersionId, SessionId } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import {
  sessionDeletionHandler,
  sessionDeletionWorkflow
} from '#server/features/conversations/workflows/deletion';
import { Materials } from '#server/features/materials/index';
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

export function setup(fixture: DeletionFixture, marker: string, target = false) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const chats = yield* Conversations;

      const materials = yield* Materials;

      const session = yield* chats.createUntitledSession({});

      const other = yield* chats.createSession({ title: 'Keep other session' });

      const library = yield* materials.createManualDocument({
        title: 'Shared independent input',
        document: { blocks: [paragraph('Independent library evidence')], meta }
      });

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
        targets: [{ versionId: library.version.id, scope: { kind: 'document' } }]
      });

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

      yield* chats.requestReply({
        sessionId: session.id,
        intentKey: 'private-reply-capture',
        instruction: marker + '-reply',
        preferences: {}
      });

      return { session, other, library, capture, request };
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

  assert.equal(event.type, 'SessionDeletionRequested');

  assert.equal(event.sessionId, id);

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

export function assertScrubbed(fixture: DeletionFixture, marker: string) {
  // Scan every logical application table, including full status, outbox and payload rows.
  // FTS shadow pages are physical index storage, not additional logical conversation records.
  const tables = fixture.context.db.orm.all<{ name: string }>(sql`
    SELECT name FROM sqlite_schema WHERE type='table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%'
    AND name != '__drizzle_migrations' ORDER BY name
  `);

  for (const table of tables) {
    const content = JSON.stringify(
      fixture.context.db.orm.all(sql.raw(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`)),
      (_, value) => (typeof value === 'bigint' ? String(value) : value)
    );

    assert.ok(!content.includes(marker), `Session capture remains in ${table.name}`);
  }
}

/** Keep exact historic annotations on independently published versions through cleanup. */
export function annotateLibrary(fixture: DeletionFixture, ids: readonly MaterialVersionId[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;

      for (const id of ids) {
        const version = yield* materials.materialVersion({ id });

        const document = fixture.context.db.orm
          .select()
          .from(s.material_document_versions)
          .where(eq(s.material_document_versions.version_id, id))
          .get();

        assert.ok(document);

        if (version.content.kind !== 'document') throw new Error('Expected Document');

        const block = version.content.blocks[0];

        assert.ok(block);

        const created = yield* materials.createAnnotation({
          target: {
            materialId: version.material_id,
            range: {
              versionId: id,
              documentId: document.document_id,
              blockId: block.id,
              start: 0,
              end: 1
            }
          },
          kind: 'note',
          note: 'Independent retained annotation'
        });

        assert.equal(created.outcome, 'saved');
      }
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function libraryState(fixture: DeletionFixture, ids: readonly MaterialVersionId[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;

      const results = [];

      for (const id of ids) {
        const version = yield* materials.materialVersion({ id });

        const citations = yield* materials.citations({ id, limit: 100 });

        const annotations = yield* materials.annotations({
          materialId: version.material_id,
          limit: 100
        });

        const histories = [];

        for (const annotation of annotations.items)
          histories.push(yield* materials.annotationHistory({ id: annotation.id, limit: 100 }));

        results.push({ version, citations, annotations, histories });
      }

      return results;
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function awaitNativeStatus(
  fixture: Awaited<ReturnType<typeof documentTransformFixture>>,
  id: string,
  status: 'running' | 'suspended' | 'completed'
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (workflowStore(fixture.context).execution(id)?.status === status) return;

      yield* Effect.sleep('5 millis');
    }

    assert.equal(workflowStore(fixture.context).execution(id)?.status, status);
  });
}
