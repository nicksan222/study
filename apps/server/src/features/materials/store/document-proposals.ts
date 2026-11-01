/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Stores session proposal identities and atomic application receipts.              │
 * │                                                                                        │
 * │ Responsibilities:                                                                      │
 * │ - Publishes guarded revisions or independent Materials with exact citations.           │
 * │                                                                                        │
 * │ Boundaries:                                                                            │
 * │ Conversations checks capture availability before invoking participants.                │
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

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { canonicalJson } from '../decoders/edit-intent.ts';
import { makeCitations } from './citations.ts';
import { makeCreateMaterial } from './create-material.ts';
import { makeDocumentEditing } from './document-editing.ts';
import { makeReads, required } from './reads.ts';
import { makeSetCitationsAction } from './set-citations-action.ts';
import { materialIntegrity } from './transactions.ts';
import { makeWrites } from './writes.ts';

const proposalSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: sessionIdSchema,
  baseVersionId: materialVersionIdSchema,
  proposedVersionId: materialVersionIdSchema
});

function makeDocumentProposals(resources: StoreResources) {
  const { db } = resources;

  const editing = makeDocumentEditing(resources);

  const reads = makeReads(resources);

  const { insertVersion, publish } = makeWrites(resources);

  const { createMaterial } = makeCreateMaterial(resources);

  const { readCitations } = makeCitations(resources);

  const { setCitations } = makeSetCitationsAction(resources);

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
    const previous = db.orm
      .select()
      .from(s.document_proposal_receipts)
      .where(eq(s.document_proposal_receipts.key, value.key))
      .get();
    if (!previous) return undefined;
    const intent = proposalIntent(value, operation);
    if (
      previous.request_id !== value.requestId ||
      previous.operation !== operation ||
      previous.intent !== intent
    )
      throw new StudyError('invalid_input', 'Application key already has a different intent');
    const captured = proposal(value);
    return {
      requestId: value.requestId,
      outcome: previous.outcome,
      baseVersionId: captured.baseVersionId,
      proposedVersionId: captured.proposedVersionId,
      currentVersionId: previous.current_version_id,
      resultVersionId: previous.result_version_id,
      replayed: true
    };
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

      const outcome = (
        receipt: typeof s.document_proposal_receipts.$inferSelect,
        replayed: boolean
      ) => ({
        requestId: captured.requestId,
        outcome: receipt.outcome,
        baseVersionId: captured.baseVersionId,
        proposedVersionId: captured.proposedVersionId,
        currentVersionId: receipt.current_version_id,
        resultVersionId: receipt.result_version_id,
        replayed
      });

      const completed = db.orm
        .select()
        .from(s.document_proposal_receipts)
        .where(
          and(
            eq(s.document_proposal_receipts.request_id, value.requestId),
            eq(s.document_proposal_receipts.operation, operation)
          )
        )
        .all()
        .find((row) => row.result_version_id !== null);

      if (completed)
        throw new StudyError(
          'invalid_input',
          'Proposal operation already completed with another key'
        );

      if (
        operation === 'apply' &&
        (!('baseVersionId' in value) ||
          value.baseVersionId !== base.id ||
          value.expectedVersionId !== base.id)
      )
        throw new StudyError('invalid_input', 'Application must declare the exact captured base');

      const relevantUnchanged = proposed.inputs.every((id) => {
        const input = required(reads.readVersion(id));

        return editing.head(input.material_id).id === id;
      });

      const conflict =
        operation === 'apply' && (current.id !== base.id || !relevantUnchanged || !relevantValid);

      let resultVersionId: MaterialVersionId | null = null;

      if (!conflict) {
        const content = proposed.content;

        if (operation === 'apply')
          resultVersionId = insertVersion(base.material_id, {
            content,
            inputs: proposed.inputs,
            parents: [base.id],
            operation: 'edit',
            language: proposed.language,
            publish: false
          });
        else {
          const material = createMaterial({
            title: Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
            )(
              required(
                db.orm
                  .select()
                  .from(s.material_generation_requests)
                  .where(eq(s.material_generation_requests.id, value.requestId))
                  .get()
              ).payload
            ).title,
            sessionId: captured.sessionId,
            projectId: 'projectId' in value ? value.projectId : undefined,
            content: {
              ...content,
              blocks: content.blocks.map((block) => createBlock(block.content))
            },
            inputs: proposed.inputs,
            operation: 'generate',
            language: proposed.language,
            publish: false
          });

          resultVersionId = material.version.id;
        }
        setCitations({ id: resultVersionId, citations: readCitations(proposed.id) });

        publish(resultVersionId);
      }

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

      return outcome(receipt, false);
    });
  }

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
        run: (value) => Option.fromNullishOr(findReceipt(value, value.operation))
      }),
      documentProposal: storeQuery({
        role: 'required',
        input: contract.proposalKeySchema,
        output: proposalSchema,
        run: proposal
      })
    },
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
      registerProposal: storeMutation({
        input: proposalSchema,
        output: Schema.Void,
        run: (value) => {
          const previous = db.orm
            .select()
            .from(s.document_proposals)
            .where(eq(s.document_proposals.request_id, value.requestId))
            .get();
          if (previous) {
            if (!Schema.toEquivalence(proposalSchema)(proposal(value), value))
              throw new StudyError(
                'invalid_input',
                'Proposal receipt has different captured identities'
              );
            return;
          }
          const base = editing.documentVersion(value.baseVersionId);
          const proposed = editing.documentVersion(value.proposedVersionId);
          if (
            base.material_id !== proposed.material_id ||
            base.status !== 'published' ||
            proposed.status !== 'draft'
          )
            throw new StudyError(
              'invalid_input',
              'Proposal revisions do not match the captured target'
            );
          db.orm
            .insert(s.document_proposals)
            .values({
              request_id: value.requestId,
              session_id: value.sessionId,
              base_version_id: value.baseVersionId,
              proposed_version_id: value.proposedVersionId
            })
            .run();
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
      queries: { documentProposal: definitions.queries.documentProposal },
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
      queries: { findDocumentProposalReceipt: definitions.queries.findDocumentProposalReceipt },
      mutations: {}
    };
  }
});
