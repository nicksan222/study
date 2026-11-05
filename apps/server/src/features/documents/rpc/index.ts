/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes authored Document procedures through public services and native Effect     │
 * │ RPC.                                                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes authored Document procedures through public services and native Effect RPC.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC forwards to public services; persistence and domain policy remain with feature       │
 * │ owners.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { DocumentsRpc } from '@study/contracts/documents/rpc';
import { StudyError } from '@study/contracts/errors';
import { Effect, Option } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const DocumentsRpcLive = defineRpc(
  DocumentsRpc,
  Effect.gen(function* () {
    const documents = yield* Documents;
    const conversations = yield* Effect.serviceOption(Conversations);

    return {
      'documents.merges': (v) => documents.merges(v),
      'documents.merge': (v) => documents.merge(v),
      'documents.requestTransform': (v) =>
        Option.isSome(conversations)
          ? conversations.value.requestDocumentTransform(v)
          : Effect.fail(new StudyError('unsupported', 'Session service is unavailable')),
      'documents.transform': (v) => documents.transform(v),
      'documents.cancelTransform': (v) => documents.cancelTransform(v),
      'documents.retryTransform': (v) =>
        Effect.gen(function* () {
          const request = yield* documents.transform(v);
          if (request.merge) return yield* documents.retryMerge(v);
          return yield* Option.isSome(conversations)
            ? conversations.value.retryDocumentTransform(v)
            : Effect.fail(new StudyError('unsupported', 'Session service is unavailable'));
        }),
      'documents.updateMetadata': (v) => documents.updateMetadata(v),
      'documents.compareProposal': (v) => documents.compareProposal(v),
      'documents.proposal': (v) => documents.proposal(v),
      'documents.applyProposal': (v) =>
        Option.isSome(conversations)
          ? conversations.value.applyDocumentProposal(v)
          : documents.applyProposal(v),
      'documents.keepProposal': (v) =>
        Option.isSome(conversations)
          ? conversations.value.keepDocumentProposal(v)
          : documents.keepProposal(v),
      'documents.assessCitation': (v) => documents.assessCitation(v),
      'documents.assessments': (v) => documents.assessments(v),
      'documents.annotations': (v) => documents.annotations(v),
      'documents.annotation': (v) => documents.annotation(v),
      'documents.annotationHistory': (v) => documents.annotationHistory(v),
      'documents.createAnnotation': (v) => documents.createAnnotation(v),
      'documents.reviseAnnotation': (v) => documents.reviseAnnotation(v),
      'documents.create': (v) => documents.create(v),
      'documents.document': (v) => documents.document(v),
      'documents.documents': (v) => documents.documents(v),
      'documents.version': (v) => documents.version(v),
      'documents.versions': (v) => documents.versions(v),
      'documents.save': (v) => documents.save(v),
      'documents.restore': (v) => documents.restore(v),
      'documents.compare': (v) => documents.compare(v),
      'documents.copySource': (v) => documents.copySource(v),
      'documents.archive': (v) => documents.archive(v),
      'documents.attachProject': (v) => documents.attachProject(v),
      'documents.detachProject': (v) => documents.detachProject(v),
      'documents.attach': (v) => documents.attach(v),
      'documents.detach': (v) => documents.detach(v),
      'documents.exportFile': (v) => documents.exportFile(v),
      'documents.exportVersion': (v) => documents.exportVersion(v),
      'documents.previewHistory': (v) => documents.previewHistory(v),
      'documents.retireHistory': (v) => documents.retireHistory(v),
      'documents.previewDeletion': (v) => documents.previewDeletion(v),
      'documents.delete': (v) => documents.delete(v)
    };
  })
);
