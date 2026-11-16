/** @file Builds notes reply versions queries and mutations with bound store resources. */

import { StudyError, replyVersionInputSchema, replyVersionSchema } from '@study/contracts';
/** Owns reply versions within this feature. */
import {
  and,
  eq,
  message_versions,
  messages,
  note_reply_requests,
  note_run_contexts,
  workflow_retired_correlations
} from '@study/db';
import { defineStore, storeQuery } from '@study/server';
import { Schema } from 'effect';

import { makeReplyAttachments } from './reply-attachments.ts';
import { replyTargetPredicate } from './reply-identity.ts';
import { codec } from './reply-schemas.ts';

export const ReplyVersionStore = defineStore({
  name: 'study/ReplyVersionStore',
  entity: { singular: 'replyVersion', plural: 'replyVersions' },
  make: (resources) => {
    const { db } = resources;
    const { assertSnapshotAttachments } = makeReplyAttachments(resources);

    function matchesRetainedRequest(
      retained: typeof note_reply_requests.$inferSelect,
      requestId: string,
      noteId: typeof messages.$inferSelect.note_id
    ) {
      return retained.request_id === requestId && retained.note_id === noteId;
    }

    function snapshotAvailable(retained: typeof note_reply_requests.$inferSelect) {
      try {
        assertSnapshotAttachments(Schema.decodeUnknownSync(codec)(retained.snapshot), true);

        return true;
      } catch (error) {
        if (
          error instanceof StudyError &&
          (error.kind === 'not_found' || error.kind === 'invalid_input')
        )
          return false;

        throw error;
      }
    }

    function retainedState(
      requestId: string,
      retained: typeof note_reply_requests.$inferSelect | undefined
    ) {
      const retired = db.orm
        .select()
        .from(workflow_retired_correlations)
        .where(
          and(
            eq(workflow_retired_correlations.correlation_id, requestId),
            eq(workflow_retired_correlations.event_type, 'NoteGenerationRequested')
          )
        )
        .get();

      if (retired) return { state: 'retired' as const, requestId };

      const context = db.orm
        .select()
        .from(note_run_contexts)
        .where(eq(note_run_contexts.request_id, requestId))
        .get();

      if (!retained || !context) return { state: 'unavailable' as const, requestId };

      return {
        state: snapshotAvailable(retained) ? ('available' as const) : ('unavailable' as const),
        requestId
      };
    }

    return {
      queries: {
        replyVersion: storeQuery({
          role: 'required',
          input: replyVersionInputSchema,
          output: replyVersionSchema,
          run: (input) => {
            const row = db.orm
              .select({ version: message_versions, message: messages })
              .from(message_versions)
              .innerJoin(messages, eq(messages.id, message_versions.message_id))
              .where(replyTargetPredicate(input))
              .get();

            if (!row) throw new StudyError('not_found', 'Message version is unavailable');

            if (row.version.origin === 'typed' || row.version.origin === 'edited')
              return { state: 'manual' as const };

            const retained = db.orm
              .select()
              .from(note_reply_requests)
              .where(eq(note_reply_requests.version_id, input.versionId))
              .get();
            const requestId = row.version.generation_request_id ?? retained?.request_id ?? null;

            if (requestId === null) return { state: 'unavailable' as const, requestId };

            if (retained && !matchesRetainedRequest(retained, requestId, input.noteId))
              return { state: 'unavailable' as const, requestId };

            return retainedState(requestId, retained);
          }
        })
      },
      mutations: {}
    };
  }
});
