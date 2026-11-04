/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Real native deletion execution helpers; all callers own fixture lifetime.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import type { MaterialId } from '@study/contracts/ids';
import { plainBlock } from '@study/contracts/sources/document';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Materials } from '#server/features/materials/index';
import {
  materialDeletionWorkflow,
  materialDeletionHandler
} from '#server/features/materials/workflows/deletion';
import { decodeEvent } from '#server/platform/workflows/events';
import type { documentTransformFixture } from '#testing/document-transform';

export type MaterialDeletionFixture = Awaited<ReturnType<typeof documentTransformFixture>>;

export function acceptMaterialDeletion(fixture: MaterialDeletionFixture, materialId: MaterialId) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;

      const preview = yield* materials.previewDeletion({ materialId });

      return yield* materials.requestDeletion({ materialId, token: preview.token });
    }).pipe(Effect.provide(fixture.domain()))
  );
}

export function materialDeletionEvent(fixture: MaterialDeletionFixture, materialId: MaterialId) {
  const events = fixture.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'MaterialDeletionRequested'))
    .all()
    .map((r) => decodeEvent(r.payload));

  const event = events.findLast(
    (e) => e.type === 'MaterialDeletionRequested' && e.materialId === materialId
  );

  assert.ok(event?.type === 'MaterialDeletionRequested');

  return event;
}

export function cleanupMaterial(fixture: MaterialDeletionFixture, materialId: MaterialId) {
  const event = materialDeletionEvent(fixture, materialId);

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(materialDeletionWorkflow, materialDeletionHandler);

        return yield* engine.execute(materialDeletionWorkflow, {
          executionId: `material-cleanup/${event.eventId}`,
          payload: { event }
        });
      }).pipe(Effect.provide(fixture.services()))
    )
  );
}

export function deletionDocument(text: string) {
  return {
    blocks: [plainBlock('paragraph', text, { type: 'authored' })],
    meta: {
      extractor: null,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: []
    }
  };
}
