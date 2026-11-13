/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists generated or user-edited note titles.                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Stores title request state and the accepted note title.                                │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the notes service applies policy and            │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { noteTitleRequestedSchema } from '@study/contracts/events';
import {
  publishTitleInputSchema,
  titleRequestSchema,
  titleSnapshotInputSchema,
  titleSnapshotSchema
} from '@study/contracts/notes/schemas';
import { and, desc, eq, sql } from '@study/db';
import { notes, workflowEvents } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';
import { decodeEvent } from '#server/platform/workflows/events';

import { makeHistory } from './history.ts';
import { makePersistence } from './persistence.ts';

const requestInput = Schema.Struct({ ...titleRequestSchema.fields });

function makeHelpers({ db, clock, timestampClock }: StoreResources) {
  const { titleHistory } = makeHistory({ db, clock, timestampClock });

  function read(requestId: string, replayTitle?: string, eventId?: string) {
    const foundEventRow = db.orm
      .select()
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.type, 'NoteTitleRequested'),
          eq(workflowEvents.correlationId, requestId)
        )
      )
      .get();

    if (!foundEventRow || foundEventRow.payload === '{}')
      throw new StudyError('not_found', 'title request not found');

    const eventRow = foundEventRow;

    const event = Schema.decodeUnknownSync(noteTitleRequestedSchema)(decodeEvent(eventRow.payload));
    const latest = db.orm
      .select()
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.type, 'NoteTitleRequested'),
          sql`json_extract(${workflowEvents.payload}, '$.noteId') = ${String(event.noteId)}`
        )
      )
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get();
    const note = db.orm.select().from(notes).where(eq(notes.id, event.noteId)).get();
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

    if (!note || !matchesTitleRequest() || note.context_revision !== event.contextRevision)
      return stale();

    const replay = isTitleReplay(note, replayTitle);

    if (!replay && (note.title_source !== event.titleSource || note.title !== event.title))
      return stale();

    assertTitleHistory(event);

    return { event, replay };
  }

  function assertTitleHistory(event: typeof noteTitleRequestedSchema.Type) {
    const stale = () => {
      throw new StudyError('invalid_input', 'title request is stale');
    };
    const current = titleHistory(event.noteId);

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

  return { read, titleHistory };
}

export const TitleStore = defineStore({
  name: 'study/NoteTitleStore',
  entity: { singular: 'titleSnapshot', plural: 'titleSnapshots' },
  make: ({ db, clock, timestampClock }) => {
    const { requiredNote } = makePersistence({ db, clock, timestampClock });
    const { read, titleHistory } = makeHelpers({ db, clock, timestampClock });

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
        captureAutomaticTitle: storeMutation({
          input: requestInput,
          output: Schema.Option(titleSnapshotSchema),
          run: (input) => {
            const note = requiredNote(input.noteId);

            if (note.title_source !== 'provisional') return Option.none();

            const history = titleHistory(note.id);

            if (!history.some((message) => message.text.trim())) return Option.none();

            const pending = db.orm
              .select({ eventId: workflowEvents.eventId })
              .from(workflowEvents)
              .where(
                and(
                  eq(workflowEvents.type, 'NoteTitleRequested'),
                  sql`json_extract(${workflowEvents.payload}, '$.noteId') = ${String(input.noteId)}`,
                  sql`json_extract(${workflowEvents.payload}, '$.contextRevision') = ${String(note.context_revision)}`
                )
              )
              .get();

            if (pending) return Option.none();

            return Option.some({
              ...input,
              contextRevision: note.context_revision,
              titleSource: note.title_source,
              title: note.title,
              messages: history
            });
          }
        }),
        captureTitle: storeMutation({
          input: requestInput,
          output: titleSnapshotSchema,
          run: (input) => {
            const note = requiredNote(input.noteId);

            return {
              ...input,
              contextRevision: note.context_revision,
              titleSource: note.title_source,
              title: note.title,
              messages: titleHistory(note.id)
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
                .update(notes)
                .set({
                  title,
                  title_source: 'generated',
                  updated_at: unixSeconds(timestampClock)
                })
                .where(eq(notes.id, event.noteId))
                .run();

            return { requestId: event.requestId, noteId: event.noteId };
          }
        })
      }
    };
  }
});

function isTitleReplay(note: typeof notes.$inferSelect, replayTitle: string | undefined) {
  return (
    replayTitle !== undefined && note.title_source === 'generated' && note.title === replayTitle
  );
}
