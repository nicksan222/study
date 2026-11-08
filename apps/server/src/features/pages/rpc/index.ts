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
  Effect.gen(function* () {
    const pages = yield* Pages;
    const notes = yield* Effect.serviceOption(Notes);

    return {
      'pages.merges': (v) => pages.merges(v),
      'pages.merge': (v) => pages.merge(v),
      'pages.requestTransform': (v) =>
        Option.isSome(notes)
          ? notes.value.requestPageTransform(v)
          : Effect.fail(new StudyError('unsupported', 'Note service is unavailable')),
      'pages.transform': (v) => pages.transform(v),
      'pages.cancelTransform': (v) => pages.cancelTransform(v),
      'pages.retryTransform': (v) =>
        Effect.gen(function* () {
          const request = yield* pages.transform(v);

          if (request.merge) return yield* pages.retryMerge(v);

          return yield* Option.isSome(notes)
            ? notes.value.retryPageTransform(v)
            : Effect.fail(new StudyError('unsupported', 'Note service is unavailable'));
        }),
      'pages.updateMetadata': (v) => pages.updateMetadata(v),
      'pages.compareProposal': (v) => pages.compareProposal(v),
      'pages.proposal': (v) => pages.proposal(v),
      'pages.applyProposal': (v) =>
        Option.isSome(notes) ? notes.value.applyPageProposal(v) : pages.applyProposal(v),
      'pages.keepProposal': (v) =>
        Option.isSome(notes) ? notes.value.keepPageProposal(v) : pages.keepProposal(v),
      'pages.assessCitation': (v) => pages.assessCitation(v),
      'pages.assessments': (v) => pages.assessments(v),
      'pages.annotations': (v) => pages.annotations(v),
      'pages.annotation': (v) => pages.annotation(v),
      'pages.annotationHistory': (v) => pages.annotationHistory(v),
      'pages.createAnnotation': (v) => pages.createAnnotation(v),
      'pages.reviseAnnotation': (v) => pages.reviseAnnotation(v),
      'pages.create': (v) => pages.create(v),
      'pages.page': (v) => pages.page(v),
      'pages.pages': (v) => pages.pages(v),
      'pages.version': (v) => pages.version(v),
      'pages.versions': (v) => pages.versions(v),
      'pages.save': (v) => pages.save(v),
      'pages.restore': (v) => pages.restore(v),
      'pages.compare': (v) => pages.compare(v),
      'pages.copySource': (v) => pages.copySource(v),
      'pages.archive': (v) => pages.archive(v),
      'pages.attachProject': (v) => pages.attachProject(v),
      'pages.detachProject': (v) => pages.detachProject(v),
      'pages.attach': (v) => pages.attach(v),
      'pages.detach': (v) => pages.detach(v),
      'pages.exportFile': (v) => pages.exportFile(v),
      'pages.exportVersion': (v) => pages.exportVersion(v),
      'pages.previewHistory': (v) => pages.previewHistory(v),
      'pages.retireHistory': (v) => pages.retireHistory(v),
      'pages.previewDeletion': (v) => pages.previewDeletion(v),
      'pages.delete': (v) => pages.delete(v)
    };
  })
);
