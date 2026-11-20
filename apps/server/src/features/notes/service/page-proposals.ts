/** @file Owns page proposals within this feature. */

import type * as editing from '@study/contracts';
import type {
  transformPublicationSchema,
  transformRequestSchema,
  transformSuggestionInputSchema
} from '@study/contracts';
import { StudyError } from '@study/contracts';
import { publicationTransaction, transaction } from '@study/server';
import { Option } from 'effect';

import { NoteContextIntentStore } from '#server/features/notes/store/context-intents';
import { NoteContextValidityStore } from '#server/features/notes/store/context-validity';
import { Pages } from '#server/features/pages/index';

import { captureContext, inputIsCurrent, readCapturedContext } from './context.ts';

export function notePageProposalOperations() {
  return {
    applyPageProposal: (value: typeof editing.applyProposalSchema.Type) =>
      transaction((tx) => {
        const replay = Pages.findProposalReceiptInTransaction(tx, {
          ...value,
          operation: 'apply'
        });

        if (replay) return replay;

        const request = Pages.findTransformInTransaction(tx, value);
        let relevantValid = true;

        if (request) {
          if (request.cancelled)
            throw new StudyError('cancelled', 'Proposal generation is unavailable');

          if (request.improvement) return Pages.applyProposalInTransaction(tx, value, true);

          const context = readCapturedContext(tx, request.contextRequestId);

          relevantValid =
            context.inputs.every((item) => inputIsCurrent(tx, item.input)) &&
            tx
              .store(NoteContextValidityStore)
              .noteContextValidity({ requestId: request.contextRequestId });
        }

        return Pages.applyProposalInTransaction(tx, value, relevantValid);
      }),
    keepPageProposal: (value: typeof editing.keepProposalSchema.Type) =>
      transaction((tx) => {
        const replay = Pages.findProposalReceiptInTransaction(tx, {
          ...value,
          operation: 'keep'
        });

        if (replay) return replay;

        const request = Pages.findTransformInTransaction(tx, value);

        if (request) {
          if (request.cancelled)
            throw new StudyError('cancelled', 'Proposal generation is unavailable');

          if (!request.improvement) readCapturedContext(tx, request.contextRequestId);
        }

        return Pages.keepProposalInTransaction(tx, value);
      }),
    requestPageTransform: (value: typeof transformRequestSchema.Type) =>
      transaction((tx) =>
        Pages.requestTransformInTransaction(
          tx,
          readCapturedContext(tx, value.contextRequestId),
          value
        )
      ),
    pageTransformContext: (value: { requestId: string }) =>
      transaction((tx) => {
        const request = Pages.transformInTransaction(tx, value);
        const context = readCapturedContext(tx, request.contextRequestId);

        if (request.cancelled || context.instruction !== request.instruction)
          throw new StudyError('cancelled', 'Page generation is unavailable');

        return context;
      }),
    publishPageTransform: (value: typeof transformPublicationSchema.Type) =>
      publicationTransaction((tx) => {
        const request = Pages.transformInTransaction(tx, value);
        const context =
          request.resultVersionId === null
            ? readCapturedContext(tx, request.contextRequestId)
            : undefined;

        return Pages.publishTransformInTransaction(tx, context, value);
      }),
    retryPageTransform: (value: { requestId: string; retryId: string }) =>
      transaction((tx) => {
        const request = Pages.transformInTransaction(tx, value);

        if (request.resultVersionId === null) readCapturedContext(tx, request.contextRequestId);

        return Pages.retryTransformInTransaction(tx, value);
      }),
    requestTransformSuggestion: (input: typeof transformSuggestionInputSchema.Type) =>
      transaction((tx) => {
        const capture = {
          noteId: input.noteId,
          additionalNoteIds: input.additionalNoteIds?.length ? input.additionalNoteIds : undefined,
          intentKey: `suggest/${input.field}/${input.intentKey}`,
          instruction: '',
          preferences: { language: input.language }
        };
        const existing = tx.store(NoteContextIntentStore).findNoteContextIntent(capture);
        const context = captureContext(tx, capture, crypto.randomUUID());
        const event = {
          type: 'TransformSuggestionRequested' as const,
          eventId: `suggest/${context.requestId}`,
          causationId: null,
          correlationId: context.requestId,
          inputVersion: 1,
          depth: 0,
          noteId: input.noteId,
          contextRequestId: context.requestId,
          field: input.field,
          language: input.language
        };

        if (Option.isNone(existing)) tx.emit(event);

        return event;
      })
  };
}
