/** @file Owns message citations within this feature. */

import {
  StudyError,
  messageVersionCitationsSchema,
  replyVersionInputSchema
} from '@study/contracts';
import { and, eq, message_versions, messages } from '@study/db';
import { defineStore, storeQuery } from '@study/server';

import { makeHelpers } from './message-rows.ts';

export const MessageVersionCitationsStore = defineStore({
  name: 'study/MessageVersionCitationsStore',
  entity: { singular: 'messageVersionCitations', plural: 'messageVersionCitationsPages' },
  make: (resources) => ({
    queries: {
      messageVersionCitations: storeQuery({
        role: 'required',
        input: replyVersionInputSchema,
        output: messageVersionCitationsSchema,
        run: (input) => {
          const helpers = makeHelpers(resources);
          const version = resources.db.orm
            .select({ id: message_versions.id })
            .from(message_versions)
            .innerJoin(messages, eq(messages.id, message_versions.message_id))
            .where(
              and(
                eq(messages.note_id, input.noteId),
                eq(messages.id, input.messageId),
                eq(message_versions.id, input.versionId)
              )
            )
            .get();

          if (!version) throw new StudyError('not_found', 'Message version not found');

          return { ...input, citations: helpers.readCitations(input.versionId) };
        }
      })
    },
    mutations: {}
  })
});
