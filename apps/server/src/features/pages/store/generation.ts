/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Publishes generated authored alternatives with immutable idempotent request        │
 * │ receipts.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Publishes generated authored alternatives with immutable idempotent request receipts.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as e from '@study/contracts/pages/editing';
import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { intentHash } from '#server/features/pages/decoders/intent';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid, required } from './errors.ts';
import { makePagePublication } from './publication.ts';

export function makePageGeneration(resources: StoreResources) {
  const { db, clock } = resources;
  const { reads, revisions, evidence, editing } = makePagePublication(resources);

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
        .insert(s.page_generation_requests)
        .values({
          id: v.requestId,
          page_id: v.pageId,
          expected_version_id: v.expectedVersionId,
          intent_hash: hash,
          created_at: now()
        })
        .run();
    }

    const replay = replayEdit(v.pageId, v.key, 'save', JSON.stringify(hash));

    if (replay) return replay;

    const base = version(v.expectedVersionId),
      current = required(head(v.pageId));

    if (base.pageId !== v.pageId || base.status !== 'published')
      invalid('Generation target requires published exact base');

    assertBlockOwnership(v.document, v.pageId);
    const row = insertVersion(
      v.pageId,
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
        .insert(s.page_proposals)
        .values({ request_id: v.requestId, base_version_id: base.id, proposed_version_id: row.id })
        .run();

    orm
      .update(s.page_generation_requests)
      .set({ result_version_id: row.id })
      .where(eq(s.page_generation_requests.id, v.requestId))
      .run();
    orm
      .insert(s.page_edit_receipts)
      .values({
        page_id: v.pageId,
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
        pageId: existing.page_id,
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
        noteId: v.noteId
      },
      v
    );
    const published = required(result.version);

    orm
      .insert(s.page_generation_requests)
      .values({
        id: v.requestId,
        page_id: result.id,
        expected_version_id: null,
        note_id: v.noteId ?? null,
        intent_hash: hash,
        result_version_id: published.id,
        created_at: now()
      })
      .run();

    return { pageId: result.id, version: published, replayed: false };
  }

  return { publishGenerated, createGenerated };
}
