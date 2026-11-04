import {
  archivedSessionItemSchema,
  sessionArchiveInputSchema,
  setSessionItemArchivedSchema
} from '@study/contracts/conversations/archive';
import { StudyError } from '@study/contracts/errors';
import {
  sourceIdSchema,
  studyDocumentIdSchema,
  messageIdSchema,
  partIdSchema
} from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import { and, desc, eq, isNull, isNotNull, lte, or, sql } from '@study/db';
import {
  messages,
  message_versions,
  message_parts,
  sessions,
  session_deletions,
  session_documents,
  session_sources,
  study_documents,
  sources
} from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

type Entry = typeof archivedSessionItemSchema.Type;

/** Active notebook reads exclude archived notes and the replies rooted in them. */
export function activeMessageCondition() {
  return sql`${messages.archived_at} IS NULL
    AND NOT EXISTS (SELECT 1 FROM messages parent WHERE parent.id = ${messages.reply_to} AND parent.archived_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM message_parts root_part JOIN messages root_note ON root_note.id=root_part.message_id
      WHERE root_part.id=${messages.thread_root} AND (root_note.archived_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM session_sources source_link WHERE source_link.session_id=${messages.session_id}
        AND source_link.source_id=root_part.source_id AND source_link.archived_at IS NOT NULL)))`;
}

function archiveReads({ db }: StoreResources) {
  function assertSession(id: SessionId) {
    if (
      !db.orm.select().from(sessions).where(eq(sessions.id, id)).get() ||
      db.orm.select().from(session_deletions).where(eq(session_deletions.session_id, id)).get()
    )
      throw new StudyError('not_found', 'Session is unavailable');
  }

  function archivedMessages(sessionId: SessionId, limit: number): Entry[] {
    return db.orm
      .select({ message: messages, text: message_versions.text })
      .from(messages)
      .leftJoin(message_versions, eq(message_versions.id, messages.active_version_id))
      .where(and(eq(messages.session_id, sessionId), isNotNull(messages.archived_at)))
      .orderBy(desc(messages.archived_at), desc(messages.id))
      .limit(limit)
      .all()
      .map(({ message, text }) => ({
        target: { kind: 'message', id: message.id },
        name: message.description ?? text?.slice(0, 120) ?? '',
        archivedAt: message.archived_at!
      }));
  }

  function archivedDocuments(sessionId: SessionId, limit: number): Entry[] {
    return db.orm
      .select({ link: session_documents, name: study_documents.title })
      .from(session_documents)
      .innerJoin(study_documents, eq(study_documents.id, session_documents.document_id))
      .where(
        and(
          eq(session_documents.session_id, sessionId),
          isNotNull(session_documents.archived_at),
          sql`NOT EXISTS(SELECT 1 FROM study_document_deletions d WHERE d.document_id=${session_documents.document_id})`
        )
      )
      .orderBy(desc(session_documents.archived_at), desc(session_documents.document_id))
      .limit(limit)
      .all()
      .map(({ link, name }) => ({
        target: { kind: 'document', id: link.document_id },
        name,
        archivedAt: link.archived_at!
      }));
  }

  function archivedSources(sessionId: SessionId, limit: number): Entry[] {
    return db.orm
      .select({ link: session_sources, name: sources.name })
      .from(session_sources)
      .innerJoin(sources, eq(sources.id, session_sources.source_id))
      .where(and(eq(session_sources.session_id, sessionId), isNotNull(session_sources.archived_at)))
      .orderBy(desc(session_sources.archived_at), desc(session_sources.source_id))
      .limit(limit)
      .all()
      .map(({ link, name }) => ({
        target: { kind: 'source', id: link.source_id },
        name,
        archivedAt: link.archived_at!
      }));
  }

  return { assertSession, archivedMessages, archivedDocuments, archivedSources };
}

/** Archive markers belong to a notebook membership; shared library content is retained. */
export const SessionArchiveStore = defineStore({
  name: 'study/SessionArchiveStore',
  entity: { singular: 'archivedItem', plural: 'archivedItems' },
  make: (resources) => {
    const { db, clock } = resources;
    const reads = archiveReads(resources);

    function setArchived(input: typeof setSessionItemArchivedSchema.Type) {
      reads.assertSession(input.sessionId);
      const archived_at = input.archived ? unixSeconds(clock) : null;
      const target = input.target;
      let changed: unknown;

      if (target.kind === 'message') {
        changed = db.orm
          .update(messages)
          .set({ archived_at })
          .where(and(eq(messages.id, target.id), eq(messages.session_id, input.sessionId)))
          .returning({ id: messages.id })
          .get();
      } else if (target.kind === 'document') {
        changed = db.orm
          .update(session_documents)
          .set({ archived_at })
          .where(
            and(
              eq(session_documents.document_id, target.id),
              eq(session_documents.session_id, input.sessionId),
              sql`NOT EXISTS(SELECT 1 FROM study_document_deletions d WHERE d.document_id=${session_documents.document_id})`
            )
          )
          .returning({ id: session_documents.document_id })
          .get();
      } else {
        changed = db.orm
          .update(session_sources)
          .set({ archived_at })
          .where(
            and(
              eq(session_sources.source_id, target.id),
              eq(session_sources.session_id, input.sessionId)
            )
          )
          .returning({ id: session_sources.source_id })
          .get();
      }
      if (!changed) throw new StudyError('not_found', 'Session item is unavailable');
      db.orm
        .update(sessions)
        .set({
          context_revision: sql`${sessions.context_revision} + 1`,
          selection_revision: sql`${sessions.selection_revision} + 1`,
          updated_at: unixSeconds(clock)
        })
        .where(eq(sessions.id, input.sessionId))
        .run();
    }

    return {
      queries: {
        archivedItems: storeQuery({
          role: 'collection',
          input: Schema.Struct({
            ...sessionArchiveInputSchema.fields,
            limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
            offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
          }),
          output: Schema.Array(archivedSessionItemSchema),
          run: ({ sessionId, limit, offset }) => {
            reads.assertSession(sessionId);
            return [
              ...reads.archivedMessages(sessionId, limit + offset),
              ...reads.archivedDocuments(sessionId, limit + offset),
              ...reads.archivedSources(sessionId, limit + offset)
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
          input: setSessionItemArchivedSchema,
          output: Schema.Void,
          run: setArchived
        })
      }
    };
  }
});

export const SessionMaterialMembershipStore = defineStore({
  name: 'study/SessionMaterialMembershipStore',
  entity: { singular: 'sessionMaterialMembership', plural: 'sessionMaterialMemberships' },
  make: (resources) => {
    const { db } = resources;
    const reads = archiveReads(resources);
    return {
      queries: {
        sessionMaterialMembership: storeQuery({
          role: 'required',
          input: Schema.Struct({
            ...sessionArchiveInputSchema.fields,
            throughMessageId: Schema.optional(messageIdSchema),
            threadRoot: Schema.optional(partIdSchema)
          }),
          output: Schema.Struct({
            documents: Schema.Array(studyDocumentIdSchema),
            sources: Schema.Array(sourceIdSchema),
            deferredSourceIds: Schema.Array(sourceIdSchema)
          }),
          run: ({ sessionId, throughMessageId, threadRoot }) => {
            reads.assertSession(sessionId);
            return {
              documents: db.orm
                .select({ id: session_documents.document_id })
                .from(session_documents)
                .innerJoin(study_documents, eq(study_documents.id, session_documents.document_id))
                .where(
                  and(
                    eq(session_documents.session_id, sessionId),
                    isNull(session_documents.archived_at),
                    isNull(study_documents.archived_at),
                    sql`NOT EXISTS(SELECT 1 FROM study_document_deletions d WHERE d.document_id=${session_documents.document_id})`
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
                    eq(messages.session_id, sessionId),
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
                .select({ id: session_sources.source_id })
                .from(session_sources)
                .where(
                  and(
                    eq(session_sources.session_id, sessionId),
                    isNull(session_sources.archived_at)
                  )
                )
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
