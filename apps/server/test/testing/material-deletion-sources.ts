/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies exact source-copy ownership fixtures for Material deletion regression     │
 * │ tests.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Uses public import and Material APIs with native recording publication.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The controlled provider fixture owns migrated SQLite and all resource cleanup.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import type { MaterialVersionId, SourceId } from '@study/contracts/ids';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { makeCreateMaterial } from '#server/features/materials/store/create-material';
import { Recordings } from '#server/features/recordings/index';
import {
  recordingPostWorkflow,
  recordingPostHandler
} from '#server/features/recordings/workflows/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import type { MaterialDeletionFixture } from '#testing/material-deletion';

export function materialExport(f: MaterialDeletionFixture, id: MaterialVersionId) {
  return Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

      return yield* client('materials.materialVersionExport', { id });
    }).pipe(Effect.provide(MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()))))
  );
}

export async function assertExportUnavailable(f: MaterialDeletionFixture, id: MaterialVersionId) {
  const error = await Effect.runPromise(Effect.flip(materialExport(f, id)));

  assert.equal(error.kind, 'not_found');
}

export async function recordingSource(f: MaterialDeletionFixture) {
  const post = await Effect.runPromise(
    Effect.gen(function* () {
      const session = yield* (yield* Conversations).createUntitledSession({});

      const recordings = yield* Recordings;

      const recording = yield* recordings.createRecording(session.id);

      yield* recordings.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });

      return yield* recordings.postRecording({
        session: session.id,
        recording: recording.id,
        name: 'source-copy.wav'
      });
    }).pipe(Effect.provide(f.domain()))
  );

  const row = f.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.eventId, post.requestId))
    .get();

  assert.ok(row);

  const event = decodeEvent(row.payload);

  if (event.type !== 'RecordingPostRequested') throw new Error('Expected recording post event');

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(recordingPostWorkflow, recordingPostHandler);

        yield* engine.execute(recordingPostWorkflow, {
          executionId: `recording-source-copy/${post.requestId}`,
          payload: { event }
        });
      }).pipe(Effect.provide(f.services()))
    )
  );

  const snapshot = await Effect.runPromise(
    Effect.flatMap(Recordings, (r) => r.recordingPostSnapshot({ requestId: post.requestId })).pipe(
      Effect.provide(f.domain())
    )
  );

  assert.ok(snapshot.sourceId !== null);

  return snapshot.sourceId;
}

export async function sourceCopies(
  f: MaterialDeletionFixture,
  kind: 'file' | 'image' | 'recording',
  linked = false
) {
  const recordingId = kind === 'recording' ? await recordingSource(f) : null;

  return Effect.runPromise(
    Effect.gen(function* () {
      const sources = yield* Sources;

      const bytes =
        kind === 'image'
          ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          : new TextEncoder().encode('SOURCE_COPY_PRIVATE_BYTES');

      const source =
        recordingId === null
          ? yield* sources.createSource({
              name: kind === 'image' ? 'copy.png' : 'copy.txt',
              bytes,
              projectId: null
            })
          : yield* sources.source(recordingId);

      const originalBytes = sourceBytes(f, source.id);

      const unrelated = yield* sources.createSource({
        name: source.name,
        bytes: originalBytes,
        projectId: null
      });

      const materials = yield* Materials;

      const original = (yield* materials.materials({ archived: false, limit: 20 })).items.find(
        (m) => m.importProcessing?.sourceId === source.id
      );

      assert.ok(original);

      // Independent source-bearing versions are a persistence invariant, not a public
      // acquisition API. Exercise the owning writer in a real server transaction.
      const copy = f.context.transaction(() =>
        makeCreateMaterial({
          db: f.context.db,
          clock: f.context.clock
        }).createMaterial({
          title: 'Independent source-bearing copy',
          publish: true,
          ...(linked ? { inputs: [original.version.id] } : {}),
          content:
            kind === 'image'
              ? { kind: 'image', sourceId: source.id, width: null, height: null }
              : { kind: 'file', sourceId: source.id }
        })
      );

      const pin = f.context.db.orm
        .select()
        .from(s.material_source_snapshots)
        .where(eq(s.material_source_snapshots.version_id, copy.version.id))
        .get();

      assert.ok(pin);

      assert.equal(pin.document_id, null);

      assert.equal(
        f.context.db.orm
          .select()
          .from(s.material_imports)
          .where(eq(s.material_imports.material_id, copy.id))
          .get(),
        undefined
      );

      return {
        source,
        original,
        originalVersionId: original.version.id,
        copy,
        unrelated,
        bytes: originalBytes
      };
    }).pipe(Effect.provide(f.domain()))
  );
}

export function sourceBytes(f: MaterialDeletionFixture, id: SourceId) {
  const row = f.context.db.orm
    .select()
    .from(s.source_blobs)
    .where(eq(s.source_blobs.source_id, id))
    .get();

  assert.ok(row);

  return new Uint8Array(row.bytes);
}

export function assertSourceGone(f: MaterialDeletionFixture, id: SourceId) {
  assert.equal(
    f.context.db.orm.select().from(s.source_blobs).where(eq(s.source_blobs.source_id, id)).all()
      .length,
    0
  );

  assert.equal(
    f.context.db.orm
      .select()
      .from(s.source_snapshots)
      .where(eq(s.source_snapshots.source_id, id))
      .all().length,
    0
  );
}
