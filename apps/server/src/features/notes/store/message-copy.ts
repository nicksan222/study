/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Copies independent notebook histories and records atomic manual merge receipts.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves copied content and original notebook ownership.                              │
 * │ - Verifies or enforces atomic merge identity and persistence.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Note stores retain private persistence behind typed transaction participants.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { MessageId, PartId, VersionId } from '@study/contracts/ids';
import { copyNoteContentSchema, recordingCopySchema } from '@study/contracts/notes/notes';
import { asc, eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';

export const copyMessagesInputSchema = Schema.Struct({
  ...copyNoteContentSchema.fields,
  recordingCopies: Schema.Array(recordingCopySchema)
});

type Copies = {
  messages: Map<MessageId, MessageId>;
  versions: Map<VersionId, VersionId>;
  parts: Map<PartId, PartId>;
};

function remapped<T>(id: T | null, copies: Map<T, T>): T | null {
  return id === null ? null : (copies.get(id) ?? null);
}

function makeVersionCopy({ db }: StoreResources) {
  return (originalId: MessageId, copiedId: MessageId, versions: Copies['versions']) => {
    for (const { id: versionId, ...version } of db.orm
      .select()
      .from(s.message_versions)
      .where(eq(s.message_versions.message_id, originalId))
      .orderBy(asc(s.message_versions.number))
      .all()) {
      if (version.status === 'pending' || version.status === 'writing')
        throw new StudyError('invalid_input', 'Wait for note work to finish before merging');

      const copy = db.orm
        .insert(s.message_versions)
        .values({
          ...version,
          message_id: copiedId,
          generation_request_id: null,
          based_on: null
        })
        .returning()
        .get();

      versions.set(versionId, copy.id);

      for (const citation of db.orm
        .select()
        .from(s.citations)
        .where(eq(s.citations.version_id, versionId))
        .all())
        db.orm
          .insert(s.citations)
          .values({ ...citation, version_id: copy.id })
          .run();
    }
  };
}

function makeMessageLinks({ db }: StoreResources) {
  return (
    rows: readonly (typeof s.messages.$inferSelect)[],
    { messages, versions, parts }: Copies
  ) => {
    for (const old of rows) {
      db.orm
        .update(s.messages)
        .set({
          reply_to: remapped(old.reply_to, messages),
          thread_root: remapped(old.thread_root, parts),
          active_version_id: remapped(old.active_version_id, versions),
          question_version_id: remapped(old.question_version_id, versions)
        })
        .where(eq(s.messages.id, messages.get(old.id)!))
        .run();

      for (const version of db.orm
        .select()
        .from(s.message_versions)
        .where(eq(s.message_versions.message_id, old.id))
        .all())
        if (version.based_on !== null)
          db.orm
            .update(s.message_versions)
            .set({ based_on: versions.get(version.based_on) ?? version.based_on })
            .where(eq(s.message_versions.id, versions.get(version.id)!))
            .run();
    }
  };
}

function makeQuestionCopies({ db }: StoreResources) {
  return ({ messages, versions }: Copies) => {
    for (const [oldVersion, newVersion] of versions) {
      const answer = db.orm
        .select()
        .from(s.note_question_answers)
        .where(eq(s.note_question_answers.version_id, oldVersion))
        .get();

      if (
        answer &&
        versions.has(answer.answer_version_id) &&
        messages.has(answer.answer_message_id)
      )
        db.orm
          .insert(s.note_question_answers)
          .values({
            ...answer,
            version_id: newVersion,
            request_id: randomUUID(),
            answer_version_id: versions.get(answer.answer_version_id)!,
            answer_message_id: messages.get(answer.answer_message_id)!
          })
          .run();
    }
  };
}

export function makeMessageCopy(resources: StoreResources) {
  const { db } = resources;
  const copyVersions = makeVersionCopy(resources);
  const copyLinks = makeMessageLinks(resources);
  const copyQuestions = makeQuestionCopies(resources);

  return ({
    noteIds: ids,
    targetNoteId: target,
    recordingCopies
  }: typeof copyMessagesInputSchema.Type) => {
    const recordingIds = new Map(recordingCopies.map((row) => [row.originalId, row.copiedId]));
    const rows = db.orm
      .select()
      .from(s.messages)
      .where(inArray(s.messages.note_id, ids))
      .orderBy(asc(s.messages.id))
      .all();
    const messages = new Map<MessageId, MessageId>();
    const versions = new Map<VersionId, VersionId>();
    const parts = new Map<PartId, PartId>();

    for (const old of rows) {
      const { id, ...values } = old;
      const created = db.orm
        .insert(s.messages)
        .values({
          ...values,
          capture_key: null,
          note_id: target,
          reply_to: null,
          thread_root: null,
          active_version_id: null,
          question_version_id: null,
          recording_id: remapped(old.recording_id, recordingIds)
        })
        .returning()
        .get();

      messages.set(id, created.id);

      for (const { id: partId, ...part } of db.orm
        .select()
        .from(s.message_parts)
        .where(eq(s.message_parts.message_id, id))
        .all()) {
        const copy = db.orm
          .insert(s.message_parts)
          .values({ ...part, message_id: created.id })
          .returning()
          .get();

        parts.set(partId, copy.id);
      }

      copyVersions(id, created.id, versions);
    }

    const copies = { messages, versions, parts };

    copyLinks(rows, copies);
    copyQuestions(copies);
  };
}
