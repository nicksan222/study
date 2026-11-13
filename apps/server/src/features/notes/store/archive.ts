/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists note note archives and reads active material memberships.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps notebook visibility and archive ordering consistent within transactions.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Page and source membership mutations remain inside their owning features.                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { sourceIdSchema, pageIdSchema, messageIdSchema, partIdSchema } from '@study/contracts/ids';
import type { NoteId } from '@study/contracts/ids';
import {
  archivedNoteItemSchema,
  noteArchiveInputSchema,
  setNoteItemArchivedSchema
} from '@study/contracts/notes/archive';
import { and, desc, eq, isNull, isNotNull, lte, or, sql } from '@study/db';
import {
  messages,
  message_versions,
  message_parts,
  notes,
  note_deletions,
  note_pages,
  note_sources,
  pages,
  sources
} from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

type Entry = typeof archivedNoteItemSchema.Type;

/** Active notebook reads exclude archived notes and the replies rooted in them. */
export function activeMessageCondition() {
  return sql`${messages.archived_at} IS NULL
    AND NOT EXISTS (SELECT 1 FROM messages parent WHERE parent.id = ${messages.reply_to} AND parent.archived_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM message_parts root_part JOIN messages root_note ON root_note.id=root_part.message_id
      WHERE root_part.id=${messages.thread_root} AND (root_note.archived_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM note_sources source_link WHERE source_link.note_id=${messages.note_id}
        AND source_link.source_id=root_part.source_id AND source_link.archived_at IS NOT NULL)))`;
}

function makeArchiveReads({ db }: StoreResources) {
  function assertNote(id: NoteId) {
    if (
      !db.orm.select().from(notes).where(eq(notes.id, id)).get() ||
      db.orm.select().from(note_deletions).where(eq(note_deletions.note_id, id)).get()
    )
      throw new StudyError('not_found', 'Note is unavailable');
  }

  function archivedMessages(noteId: NoteId, limit: number): Entry[] {
    return db.orm
      .select({ message: messages, text: message_versions.text })
      .from(messages)
      .leftJoin(message_versions, eq(message_versions.id, messages.active_version_id))
      .where(and(eq(messages.note_id, noteId), isNotNull(messages.archived_at)))
      .orderBy(desc(messages.archived_at), desc(messages.id))
      .limit(limit)
      .all()
      .map(({ message, text }) => ({
        target: { kind: 'message', id: message.id },
        name: message.description ?? text?.slice(0, 120) ?? '',
        archivedAt: message.archived_at!
      }));
  }

  function archivedPages(noteId: NoteId, limit: number): Entry[] {
    return db.orm
      .select({ link: note_pages, name: pages.title })
      .from(note_pages)
      .innerJoin(pages, eq(pages.id, note_pages.page_id))
      .where(
        and(
          eq(note_pages.note_id, noteId),
          isNotNull(note_pages.archived_at),
          sql`NOT EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=${note_pages.page_id})`
        )
      )
      .orderBy(desc(note_pages.archived_at), desc(note_pages.page_id))
      .limit(limit)
      .all()
      .map(({ link, name }) => ({
        target: { kind: 'page', id: link.page_id },
        name,
        archivedAt: link.archived_at!
      }));
  }

  function archivedSources(noteId: NoteId, limit: number): Entry[] {
    return db.orm
      .select({ link: note_sources, name: sources.name })
      .from(note_sources)
      .innerJoin(sources, eq(sources.id, note_sources.source_id))
      .where(and(eq(note_sources.note_id, noteId), isNotNull(note_sources.archived_at)))
      .orderBy(desc(note_sources.archived_at), desc(note_sources.source_id))
      .limit(limit)
      .all()
      .map(({ link, name }) => ({
        target: { kind: 'source', id: link.source_id },
        name,
        archivedAt: link.archived_at!
      }));
  }

  return { assertNote, archivedMessages, archivedPages, archivedSources };
}

/** Archive markers belong to a notebook membership; shared library content is retained. */
export const NoteArchiveStore = defineStore({
  name: 'study/NoteArchiveStore',
  entity: { singular: 'archivedItem', plural: 'archivedItems' },
  make: (resources) => {
    const { db, timestampClock } = resources;
    const reads = makeArchiveReads(resources);

    function setArchived(input: typeof setNoteItemArchivedSchema.Type) {
      reads.assertNote(input.noteId);
      const archived_at = input.archived ? unixSeconds(timestampClock) : null;
      const target = input.target;

      if (target.kind === 'message') {
        const changed = db.orm
          .update(messages)
          .set({ archived_at })
          .where(and(eq(messages.id, target.id), eq(messages.note_id, input.noteId)))
          .returning({ id: messages.id })
          .get();

        if (!changed) throw new StudyError('not_found', 'Note item is unavailable');
      }

      db.orm
        .update(notes)
        .set({
          context_revision: sql`${notes.context_revision} + 1`,
          selection_revision: sql`${notes.selection_revision} + 1`,
          updated_at: unixSeconds(timestampClock)
        })
        .where(eq(notes.id, input.noteId))
        .run();

      return archived_at;
    }

    return {
      queries: {
        archivedItems: storeQuery({
          role: 'collection',
          input: Schema.Struct({
            ...noteArchiveInputSchema.fields,
            limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
            offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
          }),
          output: Schema.Array(archivedNoteItemSchema),
          run: ({ noteId, limit, offset }) => {
            reads.assertNote(noteId);

            return [
              ...reads.archivedMessages(noteId, limit + offset),
              ...reads.archivedPages(noteId, limit + offset),
              ...reads.archivedSources(noteId, limit + offset)
            ]
              .sort((a, b) =>
                a.archivedAt > b.archivedAt ? -1 : a.archivedAt < b.archivedAt ? 1 : 0
              )
              .slice(offset, offset + limit);
          }
        })
      },
      mutations: {
        setItemArchived: storeMutation({
          input: setNoteItemArchivedSchema,
          output: Schema.NullOr(Schema.BigInt),
          run: setArchived
        })
      }
    };
  }
});

export const NoteMaterialMembershipStore = defineStore({
  name: 'study/NoteMaterialMembershipStore',
  entity: { singular: 'noteMaterialMembership', plural: 'noteMaterialMemberships' },
  make: (resources) => {
    const { db } = resources;
    const reads = makeArchiveReads(resources);

    return {
      queries: {
        noteMaterialMembership: storeQuery({
          role: 'required',
          input: Schema.Struct({
            ...noteArchiveInputSchema.fields,
            throughMessageId: Schema.optional(messageIdSchema),
            threadRoot: Schema.optional(partIdSchema)
          }),
          output: Schema.Struct({
            pages: Schema.Array(pageIdSchema),
            sources: Schema.Array(sourceIdSchema),
            deferredSourceIds: Schema.Array(sourceIdSchema)
          }),
          run: ({ noteId, throughMessageId, threadRoot }) => {
            reads.assertNote(noteId);

            return {
              pages: db.orm
                .select({ id: note_pages.page_id })
                .from(note_pages)
                .innerJoin(pages, eq(pages.id, note_pages.page_id))
                .where(
                  and(
                    eq(note_pages.note_id, noteId),
                    isNull(note_pages.archived_at),
                    isNull(pages.archived_at),
                    sql`NOT EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=${note_pages.page_id})`
                  )
                )
                .all()
                .map((x) => x.id),
              deferredSourceIds: db.orm
                .select({ id: message_parts.source_id })
                .from(message_parts)
                .innerJoin(messages, eq(messages.id, message_parts.message_id))
                .where(
                  and(
                    eq(messages.note_id, noteId),
                    activeMessageCondition(),
                    throughMessageId === undefined ? undefined : lte(messages.id, throughMessageId),
                    threadRoot === undefined
                      ? isNull(messages.thread_root)
                      : or(eq(messages.thread_root, threadRoot), eq(message_parts.id, threadRoot))
                  )
                )
                .all()
                .flatMap((row) => (row.id === null ? [] : [row.id])),
              sources: db.orm
                .select({ id: note_sources.source_id })
                .from(note_sources)
                .where(and(eq(note_sources.note_id, noteId), isNull(note_sources.archived_at)))
                .all()
                .map((x) => x.id)
            };
          }
        })
      },
      mutations: {}
    };
  }
});
