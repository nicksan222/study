/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies shared note deletion fixtures and complete logical persistence marker     │
 * │ scans.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates captured notes and reads retained library citations and annotation history.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses the controlled provider fixture and native cleanup without replacing publication    │
 * │ guards.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { pageTransformOutputSchema } from '@study/contracts/ai/page-transform';
import type { PageVersionId, NoteId } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import {
  noteDeletionHandler,
  noteDeletionWorkflow
} from '#server/features/notes/workflows/deletion';
import { Pages } from '#server/features/pages/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import type { pageTransformFixture } from '#testing/page-transform';

type DeletionFixture = Awaited<ReturnType<typeof pageTransformFixture>>;

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
  additionalInputVersionId?: PageVersionId
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const chats = yield* Notes;

      const pages = yield* Pages;

      const note = yield* chats.createUntitledNote({});

      const other = yield* chats.createNote({ title: 'Keep other note' });

      const library = yield* pages.create({
        createKey: randomUUID(),
        inputs: [],
        citations: [],
        title: 'Shared independent input',
        noteId: note.id,
        document: { blocks: [paragraph('Independent library evidence')], meta }
      });

      assert.ok(library.version);
      yield* chats.postMessage({ noteId: note.id, text: marker, requestReply: false });

      yield* chats.requestTitle({ noteId: note.id });

      yield* chats.postMessage({
        noteId: other.id,
        text: 'Other note',
        requestReply: false
      });

      yield* chats.updateNoteSelection({
        noteId: note.id,
        expectedRevision: 0n,
        targets: [
          {
            input: { kind: 'page', versionId: library.version.id },
            scope: { kind: 'document' }
          },
          ...(additionalInputVersionId === undefined
            ? []
            : [
                {
                  input: { kind: 'page' as const, versionId: additionalInputVersionId },
                  scope: { kind: 'document' as const }
                }
              ])
        ]
      });

      if (additionalInputVersionId !== undefined) {
        const additional = yield* pages.version({ id: additionalInputVersionId });

        yield* pages.attach({ noteId: note.id, pageId: additional.pageId });
      }

      const capture = yield* chats.captureNoteContext({
        noteId: note.id,
        intentKey: 'delete-capture',
        instruction: marker + '-instruction',
        preferences: {}
      });

      const request = yield* chats.requestPageTransform({
        contextRequestId: capture.requestId,
        title: 'Generated result',
        operations: ['clarity'],
        ...(target ? { editTargetVersionId: library.version.id } : {})
      });

      const pending = yield* chats.requestReply({
        noteId: note.id,
        intentKey: 'private-reply-capture',
        instruction: marker + '-reply',
        preferences: {}
      });

      return {
        note,
        other,
        library: { ...library, version: library.version },
        capture,
        request,
        pending
      };
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function deletionEvent(fixture: DeletionFixture, id: NoteId) {
  const row = fixture.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'NoteDeletionRequested'))
    .all()
    .at(-1);

  assert.ok(row);

  const event = decodeEvent(row.payload);

  assert.ok(event.type === 'NoteDeletionRequested');

  assert.strictEqual(event.noteId, id);

  return event;
}

export function cleanup(fixture: DeletionFixture, id: NoteId) {
  const event = deletionEvent(fixture, id);

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(noteDeletionWorkflow, noteDeletionHandler);

        return yield* engine.execute(noteDeletionWorkflow, {
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
  // FTS shadow pages are physical index storage, not additional logical note records.
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
          // Authored versions and requests intentionally retain their instructions; note cleanup
          // removes raw captures, not independent page generation metadata.

          if (table.name === 'page_versions') return { ...row, instruction: null };

          if (table.name === 'page_transform_requests')
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

    assert.ok(!content.includes(marker), `Note capture remains in ${table.name}`);
  }
}

/** Keep exact historic annotations on independently published versions through cleanup. */
export function annotateLibrary(fixture: DeletionFixture, ids: readonly PageVersionId[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const pages = yield* Pages;

      for (const id of ids) {
        const version = yield* pages.version({ id });
        const block = version.document.blocks[0];

        assert.ok(block);

        const created = yield* pages.createAnnotation({
          target: {
            pageId: version.pageId,
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

export function libraryState(fixture: DeletionFixture, ids: readonly PageVersionId[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const pages = yield* Pages;

      const results = [];

      for (const id of ids) {
        const version = yield* pages.version({ id });

        const citations = version.citations;

        const annotations = yield* pages.annotations({
          pageId: version.pageId,
          includeDeleted: true,
          limit: 100
        });

        const histories = [];

        for (const annotation of annotations.items)
          histories.push(yield* pages.annotationHistory({ id: annotation.id, limit: 100 }));

        results.push({ version, citations, annotations, histories });
      }

      return results;
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function awaitNativeStatus(
  fixture: Awaited<ReturnType<typeof pageTransformFixture>>,
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

export function validPageTransformOutput(text: string): typeof pageTransformOutputSchema.Type {
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
