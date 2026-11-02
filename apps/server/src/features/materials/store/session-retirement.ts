/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires session prompts and proposal drafts while preserving library versions.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains durable ownership and content-free retirement state.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy uses public participants; native Workflow owns execution.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { sessionIdSchema } from '@study/contracts/ids';
import { and, eq, inArray, isNotNull, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeContent } from './content.ts';

function makeRetirement(resources: StoreResources) {
  const { db } = resources;
  const { removeContent } = makeContent(resources);

  function retireProposal(requestId: string) {
    const proposal = db.orm
      .select()
      .from(s.document_proposals)
      .where(eq(s.document_proposals.request_id, requestId))
      .get();

    if (!proposal) return;

    const receipts = db.orm
      .select()
      .from(s.document_proposal_receipts)
      .where(eq(s.document_proposal_receipts.request_id, requestId))
      .all();

    for (const receipt of receipts) {
      if (receipt.result_version_id === null || receipt.outcome === 'conflict') continue;

      const value = {
        key: receipt.key,
        intent: receipt.intent,
        current_version_id: receipt.current_version_id,
        proposed_version_id: proposal.proposed_version_id,
        request_id: requestId,
        operation: receipt.operation,
        outcome: receipt.outcome,
        base_version_id: proposal.base_version_id,
        result_version_id: receipt.result_version_id
      };
      const previous = db.orm
        .select()
        .from(s.retired_document_proposal_receipts)
        .where(eq(s.retired_document_proposal_receipts.key, receipt.key))
        .get();

      if (previous) {
        if (
          Object.keys(value).some(
            (key) => previous[key as keyof typeof value] !== value[key as keyof typeof value]
          )
        )
          throw new StudyError(
            'invalid_input',
            'Retired proposal receipt differs from its original'
          );
      } else {
        db.orm.insert(s.retired_document_proposal_receipts).values(value).run();
      }
    }

    db.orm
      .delete(s.document_proposal_receipts)
      .where(eq(s.document_proposal_receipts.request_id, requestId))
      .run();
    db.orm.delete(s.document_proposals).where(eq(s.document_proposals.request_id, requestId)).run();
    // The generated draft is session-owned even after apply/keep copied it into a library result.
    db.orm
      .update(s.material_generation_requests)
      .set({ result_version_id: null, result_hash: null })
      .where(eq(s.material_generation_requests.id, requestId))
      .run();
    db.orm
      .delete(s.material_version_citations)
      .where(eq(s.material_version_citations.version_id, proposal.proposed_version_id))
      .run();
    db.orm
      .delete(s.material_version_inputs)
      .where(eq(s.material_version_inputs.version_id, proposal.proposed_version_id))
      .run();
    db.orm
      .delete(s.material_version_parents)
      .where(eq(s.material_version_parents.version_id, proposal.proposed_version_id))
      .run();
    removeContent(proposal.proposed_version_id);
    db.orm
      .delete(s.material_versions)
      .where(eq(s.material_versions.id, proposal.proposed_version_id))
      .run();
  }

  return {
    prepare: storeMutation({
      input: Schema.Struct({ sessionId: sessionIdSchema, contextIds: Schema.Array(Schema.String) }),
      output: Schema.Array(Schema.String),
      run: ({ sessionId, contextIds }) => {
        const requests = db.orm
          .select()
          .from(s.material_generation_requests)
          .where(
            inArray(
              sql<string>`json_extract(${s.material_generation_requests.payload}, '$.documentTransform.contextRequestId')`,
              [...contextIds]
            )
          )
          .all();

        for (const request of requests)
          db.orm
            .insert(s.session_generation_retirements)
            .values({ request_id: request.id, session_id: sessionId })
            .onConflictDoNothing()
            .run();

        return requests.map((row) => row.id);
      }
    }),
    scrub: storeMutation({
      input: sessionIdSchema,
      output: Schema.Void,
      run: (sessionId) => {
        const requests = db.orm
          .select()
          .from(s.session_generation_retirements)
          .where(eq(s.session_generation_retirements.session_id, sessionId))
          .all();

        for (const request of requests) {
          retireProposal(request.request_id);
          // Only retire private instruction metadata proven to originate in this session request.
          db.orm
            .update(s.material_versions)
            .set({ instruction: null })
            .where(
              and(
                eq(s.material_versions.generation_request_id, request.request_id),
                isNotNull(s.material_versions.instruction),
                eq(
                  s.material_versions.instruction,
                  sql<string>`(SELECT json_extract(payload, '$.instruction') FROM material_generation_requests WHERE id = ${request.request_id})`
                )
              )
            )
            .run();
          db.orm
            .update(s.material_generation_requests)
            .set({ payload: '{}', result_metadata: null, cancelled: true })
            .where(eq(s.material_generation_requests.id, request.request_id))
            .run();
          db.orm
            .delete(s.material_generation_inputs)
            .where(eq(s.material_generation_inputs.request_id, request.request_id))
            .run();
        }
      }
    })
  };
}

export const SessionMaterialRetirementStore = defineStore({
  name: 'study/SessionMaterialRetirementStore',
  entity: { singular: 'sessionMaterialRetirement', plural: 'sessionMaterialRetirements' },
  make: (resources) => ({ queries: {}, mutations: makeRetirement(resources) })
});
