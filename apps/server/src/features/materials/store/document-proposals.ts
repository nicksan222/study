/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Stores session proposal identities and atomic application receipts.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Publishes guarded revisions or independent Materials with exact citations.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations checks capture availability before invoking participants.                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId } from '@study/contracts/ids';
import { materialVersionIdSchema, sessionIdSchema } from '@study/contracts/ids';
import * as contract from '@study/contracts/materials/editing';
import { materialGenerationPayloadSchema } from '@study/contracts/materials/schemas';
import { createBlock } from '@study/contracts/sources/document';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema, Option } from 'effect';

import { canonicalJson } from '#server/features/materials/decoders/edit-intent';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDocumentRevisions } from './document-revisions.ts';
import { required } from './reads.ts';
import { materialIntegrity } from './transactions.ts';

const proposalSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: sessionIdSchema,
  baseVersionId: materialVersionIdSchema,
  proposedVersionId: materialVersionIdSchema
});

export function makeProposalRegistration(resources: StoreResources) {
  const { db } = resources;

  const editing = makeDocumentRevisions(resources);

  return (value: typeof proposalSchema.Type) => {
    const previous = db.orm
      .select()
      .from(s.document_proposals)
      .where(eq(s.document_proposals.request_id, value.requestId))
      .get();

    if (previous) {
      if (
        !Schema.toEquivalence(proposalSchema)(
          {
            requestId: previous.request_id,
            sessionId: previous.session_id,
            baseVersionId: previous.base_version_id,
            proposedVersionId: previous.proposed_version_id
          },
          value
        )
      )
        throw new StudyError('invalid_input', 'Proposal receipt has different captured identities');

      return;
    }

    const base = editing.documentVersion(value.baseVersionId);

    const proposed = editing.documentVersion(value.proposedVersionId);

    if (
      base.material_id !== proposed.material_id ||
      base.status !== 'published' ||
      proposed.status !== 'draft'
    )
      throw new StudyError('invalid_input', 'Proposal revisions do not match the captured target');

    db.orm
      .insert(s.document_proposals)
      .values({
        request_id: value.requestId,
        session_id: value.sessionId,
        base_version_id: value.baseVersionId,
        proposed_version_id: value.proposedVersionId
      })
      .run();
  };
}

function makeDocumentProposals(resources: StoreResources) {
  const { db } = resources;

  const editing = makeDocumentRevisions(resources);

  const { reads, insertVersion, publish, createMaterial, readCitations, setCitations } = editing;

  function proposal(value: typeof contract.proposalKeySchema.Type) {
    const row = required(
      db.orm
        .select()
        .from(s.document_proposals)
        .where(eq(s.document_proposals.request_id, value.requestId))
        .get()
    );

    return {
      requestId: row.request_id,
      sessionId: row.session_id,
      baseVersionId: row.base_version_id,
      proposedVersionId: row.proposed_version_id
    };
  }

  function proposalIntent(
    value:
      | typeof contract.keepDocumentProposalSchema.Type
      | typeof contract.applyDocumentProposalSchema.Type,
    operation: 'apply' | 'keep'
  ) {
    const intent =
      operation === 'apply'
        ? Schema.encodeSync(
            Schema.fromJsonString(Schema.toCodecJson(contract.applyDocumentProposalSchema))
          )(Schema.decodeUnknownSync(contract.applyDocumentProposalSchema)(value))
        : Schema.encodeSync(
            Schema.fromJsonString(Schema.toCodecJson(contract.keepDocumentProposalSchema))
          )(value);

    return canonicalJson(intent);
  }

  function findReceipt(
    value:
      | typeof contract.keepDocumentProposalSchema.Type
      | typeof contract.applyDocumentProposalSchema.Type,
    operation: 'apply' | 'keep'
  ) {
    if (
      db.orm
        .select()
        .from(s.material_history_requests)
        .where(eq(s.material_history_requests.request_id, value.requestId))
        .get()
    )
      throw new StudyError('not_found', 'Proposal input history is unavailable');
    const previous = db.orm
      .select()
      .from(s.document_proposal_receipts)
      .where(eq(s.document_proposal_receipts.key, value.key))
      .get();

    if (!previous) {
      const retired = db.orm
        .select()
        .from(s.retired_document_proposal_receipts)
        .where(eq(s.retired_document_proposal_receipts.key, value.key))
        .get();

      if (!retired) return undefined;

      if (
        retired.request_id !== value.requestId ||
        retired.operation !== operation ||
        retired.intent !== proposalIntent(value, operation)
      )
        throw new StudyError('invalid_input', 'Application key already has a different intent');

      return {
        requestId: retired.request_id,
        outcome: retired.outcome,
        baseVersionId: retired.base_version_id,
        proposedVersionId: retired.proposed_version_id,
        currentVersionId: retired.current_version_id,
        resultVersionId: retired.result_version_id,
        replayed: true
      };
    }

    const intent = proposalIntent(value, operation);

    if (
      previous.request_id !== value.requestId ||
      previous.operation !== operation ||
      previous.intent !== intent
    )
      throw new StudyError('invalid_input', 'Application key already has a different intent');

    return outcome(proposal(value), previous, true);
  }

  function outcome(
    captured: ReturnType<typeof proposal>,
    receipt: typeof s.document_proposal_receipts.$inferSelect,
    replayed: boolean
  ) {
    return {
      requestId: captured.requestId,
      outcome: receipt.outcome,
      baseVersionId: captured.baseVersionId,
      proposedVersionId: captured.proposedVersionId,
      currentVersionId: receipt.current_version_id,
      resultVersionId: receipt.result_version_id,
      replayed
    };
  }

  function assertNotCompleted(requestId: string, operation: 'apply' | 'keep') {
    const completed = db.orm
      .select()
      .from(s.document_proposal_receipts)
      .where(
        and(
          eq(s.document_proposal_receipts.request_id, requestId),
          eq(s.document_proposal_receipts.operation, operation)
        )
      )
      .all()
      .some((row) => row.result_version_id !== null);

    if (completed)
      throw new StudyError(
        'invalid_input',
        'Proposal operation already completed with another key'
      );
  }

  function assertApplicationBase(
    value:
      | typeof contract.keepDocumentProposalSchema.Type
      | typeof contract.applyDocumentProposalSchema.Type,
    baseVersionId: MaterialVersionId
  ) {
    if (
      !('baseVersionId' in value) ||
      value.baseVersionId !== baseVersionId ||
      value.expectedVersionId !== baseVersionId
    )
      throw new StudyError('invalid_input', 'Application must declare the exact captured base');
  }

  function relevantInputsUnchanged(proposed: ReturnType<typeof editing.documentVersion>) {
    return proposed.inputs.every((id) => {
      const input = required(reads.readVersion(id));

      return editing.head(input.material_id).id === id;
    });
  }

  function keepIndependent(
    value: typeof contract.keepDocumentProposalSchema.Type,
    captured: ReturnType<typeof proposal>,
    proposed: ReturnType<typeof editing.documentVersion>
  ) {
    const request = required(
      db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, value.requestId))
        .get()
    );

    const payload = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
    )(request.payload);

    const material = createMaterial({
      title: payload.title,
      sessionId: captured.sessionId,
      projectId: value.projectId,
      content: {
        ...proposed.content,
        blocks: proposed.content.blocks.map((block) => createBlock(block.content))
      },
      inputs: proposed.inputs,
      operation: 'generate',
      language: proposed.language,
      publish: false
    });

    return material.version.id;
  }

  function publishResult(
    value:
      | typeof contract.keepDocumentProposalSchema.Type
      | typeof contract.applyDocumentProposalSchema.Type,
    operation: 'apply' | 'keep',
    captured: ReturnType<typeof proposal>,
    proposed: ReturnType<typeof editing.documentVersion>,
    base: ReturnType<typeof editing.documentVersion>
  ) {
    const resultVersionId =
      operation === 'apply'
        ? insertVersion(base.material_id, {
            content: proposed.content,
            inputs: proposed.inputs,
            parents: [base.id],
            operation: 'edit',
            language: proposed.language,
            publish: false
          })
        : keepIndependent(value, captured, proposed);

    setCitations({ id: resultVersionId, citations: readCitations(proposed.id) });

    publish(resultVersionId);

    return resultVersionId;
  }

  function operate(
    value:
      | typeof contract.keepDocumentProposalSchema.Type
      | typeof contract.applyDocumentProposalSchema.Type,
    operation: 'apply' | 'keep',
    relevantValid = true
  ) {
    return materialIntegrity(() => {
      const replay = findReceipt(value, operation);

      if (replay) return replay;

      const captured = proposal(value);

      const proposed = editing.documentVersion(captured.proposedVersionId);

      const base = editing.documentVersion(captured.baseVersionId);

      const current = editing.head(base.material_id);

      const intent = proposalIntent(value, operation);

      assertNotCompleted(value.requestId, operation);

      if (operation === 'apply') assertApplicationBase(value, base.id);

      const relevantUnchanged = relevantInputsUnchanged(proposed);

      const conflict =
        operation === 'apply' && (current.id !== base.id || !relevantUnchanged || !relevantValid);

      const resultVersionId = conflict
        ? null
        : publishResult(value, operation, captured, proposed, base);

      const receipt = db.orm
        .insert(s.document_proposal_receipts)
        .values({
          key: value.key,
          request_id: value.requestId,
          operation,
          intent,
          outcome: conflict ? 'conflict' : operation === 'apply' ? 'applied' : 'kept',
          current_version_id: current.id,
          result_version_id: resultVersionId
        })
        .returning()
        .get();

      return outcome(captured, receipt, false);
    });
  }

  return {
    proposal,
    findReceipt,
    mutations: {
      assertEditableTarget: storeMutation({
        input: Schema.Struct({ versionId: materialVersionIdSchema }),
        output: Schema.Void,
        run: ({ versionId }) => {
          const version = editing.documentVersion(versionId);

          if (version.status !== 'published' || version.creator === 'import')
            throw new StudyError('invalid_input', 'Target must be an authored published Document');

          editing.head(version.material_id);
        }
      }),
      applyDocumentProposal: storeMutation({
        input: Schema.Struct({
          ...contract.applyDocumentProposalSchema.fields,
          relevantValid: Schema.Boolean
        }),
        output: contract.documentProposalOutcomeSchema,
        run: (value) => operate(value, 'apply', value.relevantValid)
      }),
      keepDocumentProposal: storeMutation({
        input: contract.keepDocumentProposalSchema,
        output: contract.documentProposalOutcomeSchema,
        run: (value) => operate(value, 'keep')
      })
    }
  };
}

export const DocumentProposalStore = defineStore({
  name: 'study/DocumentProposalStore',
  entity: { singular: 'documentProposal', plural: 'documentProposals' },
  make: (resources) => {
    const definitions = makeDocumentProposals(resources);

    return {
      queries: {
        documentProposal: storeQuery({
          role: 'required',
          input: contract.proposalKeySchema,
          output: proposalSchema,
          run: definitions.proposal
        })
      },
      mutations: definitions.mutations
    };
  }
});

export const DocumentProposalReceiptStore = defineStore({
  name: 'study/DocumentProposalReceiptStore',
  entity: { singular: 'documentProposalReceipt', plural: 'documentProposalReceipts' },
  make: (resources) => {
    const definitions = makeDocumentProposals(resources);

    return {
      queries: {
        findDocumentProposalReceipt: storeQuery({
          role: 'optional',
          input: Schema.Union([
            Schema.Struct({
              operation: Schema.Literal('apply'),
              ...contract.applyDocumentProposalSchema.fields
            }),
            Schema.Struct({
              operation: Schema.Literal('keep'),
              ...contract.keepDocumentProposalSchema.fields
            })
          ]),
          output: Schema.Option(contract.documentProposalOutcomeSchema),
          run: (value) => Option.fromNullishOr(definitions.findReceipt(value, value.operation))
        })
      },
      mutations: {}
    };
  }
});
