/** @file Owns replies within this feature. */

import type {
  noteGenerationPageInputSchema,
  publishReplyInputSchema,
  replyRequestSchema,
  replyVersionInputSchema
} from '@study/contracts';
import { StudyError } from '@study/contracts';
import { Effect, Option } from 'effect';

import { NoteContextStore } from '#server/features/notes/store/context';
import { NoteDeletionStore } from '#server/features/notes/store/deletion';
import { MessageVersionCitationsStore } from '#server/features/notes/store/message-citations';
import { QuestionStore } from '#server/features/notes/store/questions';
import { ReplyStore } from '#server/features/notes/store/reply-operations';
import { ReplyReadinessStore, ReplyWakeStore } from '#server/features/notes/store/reply-readiness';
import { ReplyRequestStore } from '#server/features/notes/store/reply-requests';
import { RetainedReplySnapshotStore } from '#server/features/notes/store/reply-retention';
import { ReplyVersionStore } from '#server/features/notes/store/reply-versions';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import {
  publicationTransaction,
  transaction,
  useStore
} from '#server/platform/definitions/define-store';

import { requireAvailableNote } from './availability.ts';
import { resolveVersionCitations } from './citations.ts';
import { assertCapturedTarget, readCapturedContext } from './context.ts';
import { scheduleAutomaticTitle } from './generation-events.ts';
import { readWorkspacePreferences } from './preferences.ts';

export function* noteReplyOperations() {
  const readReplyReadinessStore = yield* useStore(ReplyReadinessStore);

  const readReplyWakeStore = yield* useStore(ReplyWakeStore);

  return {
    replySnapshot: (input: { requestId: string }) =>
      transaction((tx) => {
        tx.store(QuestionStore).assertQuestionAnswer(input);
        const snapshot = tx.store(ReplyStore).replySnapshot(input);

        if (snapshot.context) {
          tx.store(NoteContextStore).noteContext(input);

          for (const target of snapshot.context.inputs) assertCapturedTarget(tx, target);
        }

        return snapshot;
      }),
    inspectReplySnapshot: (input: { requestId: string }) =>
      transaction((tx) => tx.store(RetainedReplySnapshotStore).retainedReplySnapshot(input)),
    replyReadiness: readReplyReadinessStore.replyReadiness,
    replyWakes: readReplyWakeStore.replyWakes,
    sealReplyAttachments: (input: { requestId: string }) =>
      publicationTransaction((tx) => {
        return tx.store(ReplyStore).sealReplyAttachments(input);
      }),
    failConversion: (input: typeof replyRequestSchema.Type) =>
      publicationTransaction((tx) => tx.store(ReplyStore).failConversion(input)),
    abandonReply: (input: typeof replyRequestSchema.Type) =>
      publicationTransaction((tx) => {
        return tx.store(ReplyStore).abandonReply(input);
      }),
    publishReply: Effect.fnUntraced(function* (input: typeof publishReplyInputSchema.Type) {
      const preferences = yield* readWorkspacePreferences();
      const language = yield* Settings.use((settings) => settings.language()).pipe(
        Effect.provide(Settings.layer)
      );

      return yield* publicationTransaction((tx) => {
        const context = tx.store(NoteContextStore).findNoteContext({ requestId: input.requestId });

        if (Option.isSome(context))
          for (const target of context.value.inputs) assertCapturedTarget(tx, target);

        tx.store(QuestionStore).assertQuestionAnswer(input);
        const versionId = tx.store(ReplyStore).publishReply({ ...input, language });

        if (preferences.autoTitleNotes) {
          const reply = tx
            .store(ReplyRequestStore)
            .findReplyRequest({ requestId: input.requestId });

          if (Option.isSome(reply)) scheduleAutomaticTitle(tx, reply.value.noteId);
        }

        return versionId;
      });
    }),
    messageVersionCitations: (input: typeof replyVersionInputSchema.Type) =>
      transaction((tx) => {
        if (Option.isSome(tx.store(NoteDeletionStore).findNoteDeletion(input.noteId)))
          throw new StudyError('not_found', 'Note is unavailable');

        const value = tx.store(MessageVersionCitationsStore).messageVersionCitations(input);

        return { ...value, citations: resolveVersionCitations(tx, value.citations) };
      }),
    noteGenerations: (input: typeof noteGenerationPageInputSchema.Type) =>
      transaction((tx) => {
        requireAvailableNote(tx, input.noteId);

        const items = Pages.transformsInTransaction(tx, input)
          .map((request) => ({
            requestId: request.id,
            contextRequestId: request.contextRequestId,
            state: 'available' as 'available' | 'unavailable' | 'retired',
            cancelled: request.cancelled,
            resultVersionId:
              request.editTargetVersionId === undefined ? request.resultVersionId : null,
            proposedVersionId:
              request.editTargetVersionId === undefined ? null : request.resultVersionId,
            baseVersionId: request.editTargetVersionId ?? null
          }))
          .map((item) => {
            if (item.state !== 'available' || item.contextRequestId === null) return item;

            try {
              readCapturedContext(tx, item.contextRequestId);

              return item;
            } catch (error) {
              if (
                error instanceof StudyError &&
                (error.kind === 'not_found' || error.kind === 'invalid_input')
              )
                return { ...item, state: 'unavailable' as const };

              throw error;
            }
          });
        const last = items.at(-1);
        const more =
          last && items.length === input.limit
            ? Pages.transformsInTransaction(tx, {
                ...input,
                limit: 1,
                before: last.requestId
              })
            : [];

        return { items, next: more.length && last ? last.requestId : null };
      }),
    replyVersion: (input: typeof replyVersionInputSchema.Type) =>
      transaction((tx) => {
        const provenance = tx.store(ReplyVersionStore).replyVersion(input);

        if (provenance.state !== 'available') return provenance;

        try {
          readCapturedContext(tx, provenance.requestId);

          return provenance;
        } catch (error) {
          if (
            error instanceof StudyError &&
            (error.kind === 'not_found' || error.kind === 'invalid_input')
          )
            return { state: 'unavailable' as const, requestId: provenance.requestId };

          throw error;
        }
      })
  };
}
