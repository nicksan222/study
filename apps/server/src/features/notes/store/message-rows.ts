/** @file Owns message rows within this feature. */

import type { MessageId, NoteId, postMessageInputSchema } from '@study/contracts';
import { StudyError, anchorSchema } from '@study/contracts';
import {
  and,
  asc,
  citations,
  eq,
  message_parts,
  message_section_titles,
  message_versions,
  messages,
  note_question_answers,
  notes,
  sql
} from '@study/db';
import { unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { citationInput, citationPrecision } from './citation-rows.ts';
import { assertCaptureReplay } from './message-replay.ts';
import { makeThread } from './thread.ts';

/** Binds message reads and version projections to the current database and clock. */
export function makeHelpers({ db, clock, timestampClock }: StoreResources) {
  const { assertThreadRoot } = makeThread({ db, clock, timestampClock });

  function readCitations(versionId: typeof message_versions.$inferSelect.id) {
    return db.orm
      .select()
      .from(citations)
      .where(eq(citations.version_id, versionId))
      .orderBy(asc(citations.marker))
      .all()
      .map((c) => ({
        origin: 'agent' as const,
        precision: citationPrecision(c),
        support: { state: 'unassessed' as const },
        marker: Number(c.marker),
        sourceId: c.source_id,
        input: citationInput(c),
        documentId: c.document_id,
        blockId: c.block_id,
        rangeStart: c.range_start === null ? null : Number(c.range_start),
        rangeEnd: c.range_end === null ? null : Number(c.range_end),
        sourceName: c.source_name,
        anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(c.anchor)),
        quote: c.quote
      }));
  }

  /** Reads classification, answer linkage and immutable versions from the same database state. */
  function read(id: MessageId) {
    const m = db.orm.select().from(messages).where(eq(messages.id, id)).get();

    if (!m) return null;

    const sectionTitle =
      m.active_version_id === null
        ? undefined
        : db.orm
            .select()
            .from(message_section_titles)
            .where(eq(message_section_titles.version_id, m.active_version_id))
            .get();

    const answer = m.question_version_id
      ? db.orm
          .select({
            messageId: note_question_answers.answer_message_id,
            versionId: note_question_answers.answer_version_id,
            requestId: note_question_answers.request_id,
            archivedAt: messages.archived_at
          })
          .from(note_question_answers)
          .leftJoin(messages, eq(messages.id, note_question_answers.answer_message_id))
          .where(eq(note_question_answers.version_id, m.question_version_id))
          .get()
      : undefined;

    const question = () =>
      m.question_kind && m.question_origin && m.question_version_id
        ? {
            kind: m.question_kind,
            origin: m.question_origin,
            versionId: m.question_version_id,
            answerMessageId: answer?.messageId,
            answerVersionId: answer?.versionId,
            answerRequestId: answer?.requestId,
            answerArchived: answer?.archivedAt != null
          }
        : undefined;

    return {
      question: question(),
      ...(sectionTitle
        ? { sectionTitle: { versionId: sectionTitle.version_id, title: sectionTitle.title } }
        : {}),
      id: m.id,
      noteId: m.note_id,
      role: m.role,
      threadRoot: m.thread_root,
      replyTo: m.reply_to,
      activeVersionId: m.active_version_id,
      recordingId: m.recording_id,
      recordingMs: m.recording_ms,
      recordedIn: m.recorded_in,
      captureKey: m.capture_key,
      format: m.format,
      description: m.description,
      createdAt: m.created_at,
      versions: db.orm
        .select()
        .from(message_versions)
        .where(eq(message_versions.message_id, id))
        .orderBy(asc(message_versions.number))
        .all()
        .map((v) => ({
          id: v.id,
          number: v.number,
          origin: v.origin,
          status: v.status,
          ...(v.status === 'failed' && v.generation_request_id !== null
            ? { generationRequestId: v.generation_request_id }
            : {}),
          text: v.text,
          basedOn: v.based_on,
          instruction: v.instruction,
          createdAt: v.created_at
        })),
      parts: db.orm
        .select()
        .from(message_parts)
        .where(
          and(
            eq(message_parts.message_id, id),
            sql`NOT EXISTS (
          SELECT 1 FROM note_sources archived_source
          WHERE archived_source.note_id=${m.note_id}
          AND archived_source.source_id=${message_parts.source_id}
          AND archived_source.archived_at IS NOT NULL
        )`
          )
        )
        .orderBy(asc(message_parts.ordinal))
        .all()
        .map((p) => ({
          id: p.id,
          sourceId: p.source_id,
          sourceName: p.source_name,
          sourceKind: p.source_kind
        })),
      citations: m.active_version_id === null ? [] : readCitations(m.active_version_id)
    };
  }

  function required(id: MessageId) {
    const value = read(id);

    if (!value) throw new StudyError('not_found', 'message not found');

    return value;
  }

  function touch(id: NoteId) {
    db.orm
      .update(notes)
      .set({
        updated_at: unixSeconds(timestampClock),
        context_revision: sql`${notes.context_revision} + 1`
      })
      .where(eq(notes.id, id))
      .run();
  }

  /** Replays text-only note creation without duplicating a page or generation request. */
  function capturedNote(input: typeof postMessageInputSchema.Type) {
    if (!input.captureKey) return null;

    if (input.requestReply !== false || input.sourceIds?.length)
      throw new StudyError('invalid_input', 'capture keys require a text-only note');

    const row = db.orm
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.note_id, input.noteId), eq(messages.capture_key, input.captureKey)))
      .get();

    if (!row) return null;

    const message = required(row.id);

    assertCaptureReplay(message, input);

    return message;
  }

  return { read, required, touch, assertThreadRoot, readCitations, capturedNote };
}
