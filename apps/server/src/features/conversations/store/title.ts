import {
  publishTitleInputSchema,
  titleRequestSchema,
  titleSnapshotInputSchema,
  titleSnapshotSchema
} from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { conversationTitleRequestedSchema } from '@study/contracts/events';
import { and, desc, eq, sql } from '@study/db';
import { sessions, workflowEvents } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeHistory } from './history.ts';
import { makePersistence } from './persistence.ts';

const requestInput = Schema.Struct({ ...titleRequestSchema.fields });

function makeHelpers({ db, clock }: StoreResources) {
  const { conversationHistory } = makeHistory({ db, clock });

  function read(requestId: string, replayTitle?: string, eventId?: string) {
    const foundEventRow = db.orm
      .select()
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.type, 'ConversationTitleRequested'),
          eq(workflowEvents.correlationId, requestId)
        )
      )
      .get();

    if (!foundEventRow) throw new StudyError('not_found', 'title request not found');

    const eventRow = foundEventRow;

    const event = Schema.decodeUnknownSync(conversationTitleRequestedSchema)(
      decodeEvent(eventRow.payload)
    );
    const latest = db.orm
      .select()
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.type, 'ConversationTitleRequested'),
          sql`json_extract(${workflowEvents.payload}, '$.sessionId') = ${String(event.sessionId)}`
        )
      )
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get();
    const session = db.orm.select().from(sessions).where(eq(sessions.id, event.sessionId)).get();
    const stale = () => {
      throw new StudyError('invalid_input', 'title request is stale');
    };

    function matchesTitleRequest() {
      return !(
        latest?.eventId !== event.eventId ||
        event.eventId !== eventRow.eventId ||
        event.requestId !== requestId ||
        (eventId !== undefined && event.eventId !== eventId) ||
        event.correlationId !== requestId
      );
    }

    if (
      !session ||
      !matchesTitleRequest() ||
      session.project_id !== event.projectId ||
      session.context_revision !== event.contextRevision ||
      session.title_source === 'user'
    )
      return stale();

    const replay = isTitleReplay(session, replayTitle);

    if (!replay && (session.title_source !== event.titleSource || session.title !== event.title))
      return stale();

    assertTitleHistory(event);

    return { event, replay };
  }

  function assertTitleHistory(event: typeof conversationTitleRequestedSchema.Type) {
    const stale = () => {
      throw new StudyError('invalid_input', 'title request is stale');
    };
    const current = conversationHistory(event.sessionId);

    if (
      current.length !== event.messages.length ||
      current.some((m, i) => {
        const old = event.messages[i];

        return (
          !old ||
          m.messageId !== old.messageId ||
          m.versionId !== old.versionId ||
          m.role !== old.role ||
          m.text !== old.text
        );
      })
    )
      return stale();
  }

  return { read, conversationHistory };
}

export const TitleStore = defineStore({
  name: 'study/ConversationTitleStore',
  entity: { singular: 'titleSnapshot', plural: 'titleSnapshots' },
  make: ({ db, clock }) => {
    const { requiredSession } = makePersistence({ db, clock });
    const { read, conversationHistory } = makeHelpers({ db, clock });

    return {
      queries: {
        titleSnapshot: storeQuery({
          role: 'required',
          input: titleSnapshotInputSchema,
          output: titleSnapshotSchema,
          run: (input) => read(input.requestId, undefined, input.eventId).event
        })
      },
      mutations: {
        captureTitle: storeMutation({
          input: requestInput,
          output: titleSnapshotSchema,
          run: (input) => {
            const session = requiredSession(input.sessionId);

            if (session.title_source !== 'provisional')
              throw new StudyError('invalid_input', 'user title cannot be generated');

            return {
              ...input,
              projectId: session.project_id,
              contextRevision: session.context_revision,
              titleSource: session.title_source,
              title: session.title,
              messages: conversationHistory(session.id)
            };
          }
        }),
        publishTitle: storeMutation({
          input: publishTitleInputSchema,
          output: titleRequestSchema,
          run: (input) => {
            const title = input.title.trim();

            if (!title || [...title].length > 200)
              throw new StudyError('invalid_input', 'invalid generated title');

            const { event, replay } = read(input.requestId, title);

            if (!replay)
              db.orm
                .update(sessions)
                .set({
                  title,
                  title_source: 'generated',
                  updated_at: unixSeconds(clock)
                })
                .where(eq(sessions.id, event.sessionId))
                .run();

            return { requestId: event.requestId, sessionId: event.sessionId };
          }
        })
      }
    };
  }
});

function isTitleReplay(session: typeof sessions.$inferSelect, replayTitle: string | undefined) {
  return (
    replayTitle !== undefined &&
    session.title_source === 'generated' &&
    session.title === replayTitle
  );
}
