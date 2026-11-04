/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Publishes generated authored alternatives with immutable idempotent request        │
 * │ receipts.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Publishes generated authored alternatives with immutable idempotent request receipts.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Documents ownership; callers own            │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as e from '@study/contracts/documents/editing';
import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { intentHash } from '#server/features/documents/decoders/intent';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid, required } from './errors.ts';
import { makeDocumentPublication } from './publication.ts';

export function makeDocumentGeneration(resources: StoreResources) {
  const { db, clock } = resources;
  const { reads, revisions, evidence, editing } = makeDocumentPublication(resources);

  const orm = db.orm;
  const now = () => unixSeconds(clock);
  const { version, head } = reads;
  const { insertVersion, publish } = revisions;
  const { assertInput, assertCitations, assertBlockOwnership } = evidence;
  const { replayEdit, create } = editing;

  function publishGenerated(v: typeof e.publishSchema.Type) {
    const hash = intentHash(e.publishSchema, v);
    const old = reads.generationRequest(v.requestId);

    if (old && old.intent_hash !== hash) invalid('Generation request already has another intent');

    if (!old) {
      v.inputs.forEach((i) => assertInput(i));
      assertCitations(v.citations);
      orm
        .insert(s.study_document_generation_requests)
        .values({
          id: v.requestId,
          document_id: v.documentId,
          expected_version_id: v.expectedVersionId,
          intent_hash: hash,
          created_at: now()
        })
        .run();
    }

    const replay = replayEdit(v.documentId, v.key, 'save', JSON.stringify(hash));

    if (replay) return replay;

    const base = version(v.expectedVersionId),
      current = required(head(v.documentId));

    if (base.documentId !== v.documentId || base.status !== 'published')
      invalid('Generation target requires published exact base');

    assertBlockOwnership(v.document, v.documentId);
    const row = insertVersion(
      v.documentId,
      v.document,
      [base.id],
      v.inputs,
      v.citations,
      v.operation,
      'agent',
      v.instruction,
      v.language
    );
    const outcome = current.id === base.id ? ('saved' as const) : ('conflict' as const);

    if (outcome === 'saved') publish(row.id);
    else
      orm
        .insert(s.study_document_proposals)
        .values({ request_id: v.requestId, base_version_id: base.id, proposed_version_id: row.id })
        .run();

    orm
      .update(s.study_document_generation_requests)
      .set({ result_version_id: row.id })
      .where(eq(s.study_document_generation_requests.id, v.requestId))
      .run();
    orm
      .insert(s.study_document_edit_receipts)
      .values({
        document_id: v.documentId,
        key: v.key,
        operation: 'save',
        intent: JSON.stringify(hash),
        expected_version_id: base.id,
        current_version_id: current.id,
        submitted_version_id: row.id,
        outcome
      })
      .run();

    return {
      outcome,
      replayed: false,
      expectedVersionId: base.id,
      currentVersionId: current.id,
      submittedVersionId: row.id
    };
  }

  function createGenerated(v: typeof e.createGeneratedSchema.Type) {
    const hash = intentHash(e.createGeneratedSchema, v);
    const existing = reads.generationRequest(v.requestId);

    if (existing) {
      if (existing.intent_hash !== hash || existing.expected_version_id !== null)
        invalid('Generation request already has another publication intent');

      return {
        documentId: existing.document_id,
        version: reads.version(required(existing.result_version_id)),
        replayed: true
      };
    }

    const result = create(
      {
        createKey: 'generated:' + hash,
        title: v.title,
        document: v.document,
        inputs: v.inputs,
        citations: v.citations,
        projectId: v.projectId,
        sessionId: v.sessionId
      },
      v
    );
    const published = required(result.version);

    orm
      .insert(s.study_document_generation_requests)
      .values({
        id: v.requestId,
        document_id: result.id,
        expected_version_id: null,
        session_id: v.sessionId ?? null,
        intent_hash: hash,
        result_version_id: published.id,
        created_at: now()
      })
      .run();

    return { documentId: result.id, version: published, replayed: false };
  }

  return { publishGenerated, createGenerated };
}
