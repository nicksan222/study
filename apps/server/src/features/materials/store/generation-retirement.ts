/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Shares exact generation dependency scans and private-payload retirement writes.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Finds affected generation inputs, outputs and captured contexts using canonical        │
 * │   codecs.                                                                                │
 * │ - Scrubs proposal drafts and generation payloads through the Material owner.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers prove operation ownership; this helper grants no deletion or history authority.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialVersionId, MaterialId } from '@study/contracts/ids';
import { materialGenerationPayloadSchema } from '@study/contracts/materials/schemas';
import { eq, inArray, and, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';

const payloadCodec = Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema));

type RetirementScope = { kind: 'deletion'; id: MaterialId } | { kind: 'history'; id: string };

export function makeGenerationRetirement(resources: StoreResources) {
  const { db } = resources;

  function affectedRequests(versionIds: readonly MaterialVersionId[]) {
    const requests = db.orm
      .select({ id: s.material_versions.generation_request_id })
      .from(s.material_versions)
      .where(inArray(s.material_versions.id, versionIds))
      .all()
      .flatMap((row) => (row.id === null ? [] : [row.id]));
    return db.orm
      .select()
      .from(s.material_generation_requests)
      .where(inArray(s.material_generation_requests.id, requests))
      .all();
  }

  function isScrubbed(requestId: string) {
    const request = db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, requestId))
      .get();

    const input = db.orm
      .select()
      .from(s.material_evidence_inputs)
      .where(eq(s.material_evidence_inputs.request_id, requestId))
      .get();

    return (
      request?.payload === '{}' &&
      request.cancelled &&
      request.result_version_id === null &&
      request.result_hash === null &&
      input === undefined
    );
  }

  function scrubRequest(requestId: string) {
    db.orm
      .update(s.material_versions)
      .set({ instruction: null })
      .where(
        and(
          eq(s.material_versions.generation_request_id, requestId),
          sql`${s.material_versions.instruction} IS (SELECT json_extract(payload,'$.instruction') FROM material_generation_requests WHERE id=${requestId})`
        )
      )
      .run();

    db.orm
      .update(s.material_generation_requests)
      .set({
        payload: '{}',
        cancelled: true,
        result_version_id: null,
        result_hash: null
      })
      .where(eq(s.material_generation_requests.id, requestId))
      .run();

    db.orm
      .delete(s.material_evidence_inputs)
      .where(eq(s.material_evidence_inputs.request_id, requestId))
      .run();
  }

  function retainRequest(scope: RetirementScope, requestId: string) {
    if (scope.kind === 'deletion') {
      db.orm
        .insert(s.material_deletion_requests)
        .values({ request_id: requestId, deletion_id: scope.id, kind: 'generation' })
        .run();
    } else {
      db.orm
        .insert(s.material_history_requests)
        .values({ request_id: requestId, operation_id: scope.id, kind: 'generation' })
        .run();
    }
  }

  function scrubOwnedRequests(scope: RetirementScope) {
    const owners =
      scope.kind === 'deletion' ? s.material_deletion_requests : s.material_history_requests;
    const predicate =
      scope.kind === 'deletion'
        ? eq(s.material_deletion_requests.deletion_id, scope.id)
        : eq(s.material_history_requests.operation_id, scope.id);
    const requests = db.orm
      .select({ requestId: owners.request_id })
      .from(owners)
      .where(and(predicate, eq(owners.kind, 'generation')))
      .all();

    for (const request of requests) scrubRequest(request.requestId);
  }

  return {
    affectedRequests,
    isScrubbed,
    retainRequest,
    scrubRequest,
    scrubOwnedRequests
  };
}
