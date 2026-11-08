/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes authored Page procedures through public services and native Effect         │
 * │ RPC.                                                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes authored Page procedures through public services and native Effect RPC.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC forwards to public services; persistence and domain policy remain with feature       │
 * │ owners.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { PagesRpc } from '@study/contracts/pages/rpc';
import { Effect, Option } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const PagesRpcLive = defineRpc(
  PagesRpc,
  { pages: Pages, notes: Effect.serviceOption(Notes) },
  ({ pages, notes }) => ({
    'pages.merges': pages.merges,
    'pages.merge': pages.merge,
    'pages.requestTransform': (v) =>
      Option.isSome(notes)
        ? notes.value.requestPageTransform(v)
        : Effect.fail(new StudyError('unsupported', 'Note service is unavailable')),
    'pages.transform': pages.transform,
    'pages.cancelTransform': pages.cancelTransform,
    'pages.retryTransform': (v) =>
      Effect.gen(function* () {
        const request = yield* pages.transform(v);

        if (request.merge) return yield* pages.retryMerge(v);

        return yield* Option.isSome(notes)
          ? notes.value.retryPageTransform(v)
          : Effect.fail(new StudyError('unsupported', 'Note service is unavailable'));
      }),
    'pages.updateMetadata': pages.updateMetadata,
    'pages.compareProposal': pages.compareProposal,
    'pages.proposal': pages.proposal,
    'pages.applyProposal': (v) =>
      Option.isSome(notes) ? notes.value.applyPageProposal(v) : pages.applyProposal(v),
    'pages.keepProposal': (v) =>
      Option.isSome(notes) ? notes.value.keepPageProposal(v) : pages.keepProposal(v),
    'pages.assessCitation': pages.assessCitation,
    'pages.assessments': pages.assessments,
    'pages.annotations': pages.annotations,
    'pages.annotation': pages.annotation,
    'pages.annotationHistory': pages.annotationHistory,
    'pages.createAnnotation': pages.createAnnotation,
    'pages.reviseAnnotation': pages.reviseAnnotation,
    'pages.create': pages.create,
    'pages.page': pages.page,
    'pages.pages': pages.pages,
    'pages.version': pages.version,
    'pages.versions': pages.versions,
    'pages.save': pages.save,
    'pages.restore': pages.restore,
    'pages.compare': pages.compare,
    'pages.copySource': pages.copySource,
    'pages.archive': pages.archive,
    'pages.attachProject': pages.attachProject,
    'pages.detachProject': pages.detachProject,
    'pages.attach': pages.attach,
    'pages.detach': pages.detach,
    'pages.exportFile': pages.exportFile,
    'pages.exportVersion': pages.exportVersion,
    'pages.previewHistory': pages.previewHistory,
    'pages.retireHistory': pages.retireHistory,
    'pages.previewDeletion': pages.previewDeletion,
    'pages.delete': pages.delete
  })
);
