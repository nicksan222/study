/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retains exact authored proposals until explicit user application or retirement.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Retains exact authored proposals until explicit user application or retirement.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import * as e from '@study/contracts/pages/editing';
import { blockIdSchema } from '@study/contracts/sources/schemas';
import { eq, and } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { intentHash } from '#server/features/pages/decoders/intent';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid, required } from './errors.ts';
import { makePagePublication } from './publication.ts';

export function makePageProposals(resources: StoreResources) {
  const { db, clock } = resources;
  const { reads, revisions, evidence, editing } = makePagePublication(resources);

  const orm = db.orm;

  function proposal(v: typeof e.proposalKeySchema.Type) {
    const row = required(
      orm.select().from(s.page_proposals).where(eq(s.page_proposals.request_id, v.requestId)).get()
    );
    const base = reads.liveVersion(row.base_version_id);

    reads.liveVersion(row.proposed_version_id);

    return {
      requestId: row.request_id,
      pageId: base.page_id,
      baseVersionId: row.base_version_id,
      proposedVersionId: row.proposed_version_id,
      currentVersionId: required(reads.head(base.page_id)).id
    };
  }

  function proposeGenerated(v: typeof e.publishSchema.Type) {
    const hash = intentHash(e.publishSchema, v);
    const existing = reads.generationRequest(v.requestId);

    if (existing) {
      if (existing.intent_hash !== hash) invalid('Generation request already has another intent');

      return proposal(v);
    }

    const base = reads.version(v.expectedVersionId);

    if (base.pageId !== v.pageId || base.status !== 'published')
      invalid('Proposal requires the exact published target');

    v.inputs.forEach((i) => evidence.assertInput(i));
    evidence.assertCitations(v.citations);
    evidence.assertBlockOwnership(v.document, v.pageId);
    const proposed = revisions.insertVersion(
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

    orm
      .insert(s.page_generation_requests)
      .values({
        id: v.requestId,
        page_id: v.pageId,
        expected_version_id: base.id,
        intent_hash: hash,
        created_at: unixSeconds(clock)
      })
      .run();
    orm
      .insert(s.page_proposals)
      .values({
        request_id: v.requestId,
        base_version_id: base.id,
        proposed_version_id: proposed.id
      })
      .run();
    orm
      .update(s.page_generation_requests)
      .set({ result_version_id: proposed.id })
      .where(eq(s.page_generation_requests.id, v.requestId))
      .run();

    return proposal(v);
  }

  type Application = typeof e.applyProposalSchema.Type | typeof e.keepProposalSchema.Type;

  function receipt(v: Application, operation: 'apply' | 'keep') {
    const intent = JSON.stringify(
      operation === 'apply'
        ? intentHash(e.applyProposalSchema, Schema.decodeUnknownSync(e.applyProposalSchema)(v))
        : intentHash(e.keepProposalSchema, Schema.decodeUnknownSync(e.keepProposalSchema)(v))
    );
    const old = orm
      .select()
      .from(s.page_proposal_receipts)
      .where(eq(s.page_proposal_receipts.key, v.key))
      .get();

    if (
      old &&
      (old.request_id !== v.requestId || old.operation !== operation || old.intent !== intent)
    )
      invalid('Proposal key already has another intent');

    const p = required(
      orm.select().from(s.page_proposals).where(eq(s.page_proposals.request_id, v.requestId)).get()
    );

    return { intent, p, old };
  }

  function outcome(
    p: typeof s.page_proposals.$inferSelect,
    row: typeof s.page_proposal_receipts.$inferSelect,
    replayed: boolean
  ) {
    return {
      requestId: p.request_id,
      outcome: row.outcome,
      baseVersionId: p.base_version_id,
      proposedVersionId: p.proposed_version_id,
      currentVersionId: row.current_version_id,
      resultVersionId: row.result_version_id,
      replayed
    };
  }

  function applyProposal(v: typeof e.applyProposalSchema.Type & { relevantValid?: boolean }) {
    const { intent, p, old } = receipt(v, 'apply');

    if (old) return outcome(p, old, true);

    const captured = proposal(v);
    const proposed = reads.version(p.proposed_version_id);
    const expected = reads.version(v.expectedVersionId);

    if (
      expected.pageId !== captured.pageId ||
      expected.status !== 'published' ||
      expected.id !== p.base_version_id
    )
      invalid('Application requires a published version of the exact target');

    assertIncomplete(v.requestId, 'apply');
    proposed.inputs.forEach((i) => evidence.assertInput(i));
    let result = null;

    if (v.relevantValid !== false && captured.currentVersionId === expected.id) {
      const row = revisions.insertVersion(
        captured.pageId,
        proposed.document,
        [expected.id, p.base_version_id],
        proposed.inputs,
        proposed.citations,
        'edit',
        'user',
        proposed.instruction,
        proposed.language
      );

      revisions.publish(row.id);
      result = row.id;
    }

    const row = orm
      .insert(s.page_proposal_receipts)
      .values({
        key: v.key,
        request_id: v.requestId,
        operation: 'apply',
        intent,
        outcome: result === null ? 'conflict' : 'applied',
        current_version_id: captured.currentVersionId,
        result_version_id: result
      })
      .returning()
      .get();

    return outcome(p, row, false);
  }

  function assertIncomplete(requestId: string, operation: 'apply' | 'keep') {
    const completed = orm
      .select()
      .from(s.page_proposal_receipts)
      .where(
        and(
          eq(s.page_proposal_receipts.request_id, requestId),
          eq(s.page_proposal_receipts.operation, operation)
        )
      )
      .all()
      .some((r) => r.result_version_id !== null);

    if (completed) invalid('Proposal operation already completed with another key');
  }

  function keepProposal(v: typeof e.keepProposalSchema.Type) {
    const { intent, p, old } = receipt(v, 'keep');

    if (old) return outcome(p, old, true);

    assertIncomplete(v.requestId, 'keep');
    const captured = proposal(v);
    const proposed = reads.version(p.proposed_version_id);
    const independent = editing.create(
      {
        createKey: 'proposal:' + intentHash(e.keepProposalSchema, v),
        title: v.title,
        document: {
          ...proposed.document,
          blocks: proposed.document.blocks.map((b) => ({
            ...b,
            id: Schema.decodeUnknownSync(blockIdSchema)(
              createHash('sha256')
                .update(v.key + ':' + b.id)
                .digest('hex')
            )
          }))
        },
        inputs: proposed.inputs,
        citations: proposed.citations
      },
      {
        operation: proposed.operation === 'translate' ? 'translate' : 'generate',
        instruction: proposed.instruction ?? 'Retained proposal',
        language: proposed.language
      }
    );
    const row = orm
      .insert(s.page_proposal_receipts)
      .values({
        key: v.key,
        request_id: v.requestId,
        operation: 'keep',
        intent,
        outcome: 'kept',
        current_version_id: captured.currentVersionId,
        result_version_id: required(independent.version).id
      })
      .returning()
      .get();

    return outcome(p, row, false);
  }

  function findProposalReceipt(v: Application & { operation: 'apply' | 'keep' }) {
    const { p, old } = receipt(v, v.operation);

    return old ? outcome(p, old, true) : null;
  }

  return { proposal, proposeGenerated, applyProposal, keepProposal, findProposalReceipt };
}
