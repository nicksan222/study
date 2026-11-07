/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects active completed messages and conversations while respecting deletion     │
 * │ barriers.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Projects current published content into typed searchable entity records.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Owning feature visibility and membership rules remain outside the shared search          │
 * │ platform.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ConversationMode } from '@study/contracts/conversations/schemas';
import type { ProjectId, SessionId } from '@study/contracts/ids';
import type { SearchProjection, SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { and, asc, eq, inArray, sql } from '@study/db';
import { messages, message_versions, project_sessions, sessions } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';

type ConversationEntry = Omit<SearchProjection, 'projectIds'> & { sessionId: SessionId };

/** Project visible sessions and completed active message versions with canonical navigation targets. */
export function makeConversationSearchProjections({ db }: StoreResources) {
  const visible = and(
    eq(sessions.mode, ConversationMode.Notebook),
    sql`NOT EXISTS (SELECT 1 FROM session_deletions d WHERE d.session_id = ${sessions.id})`
  );
  /** Page nondeleted session identities and titles without loading conversation contents. */
  const sessionEntries = (input: SearchProjectionPageInput): ConversationEntry[] => {
    const entries: ConversationEntry[] = [];
    const { offset, limit, targets } = input;
    const selected = targets?.filter((target) => target.type === 'session');
    const filter =
      selected === undefined
        ? undefined
        : selected.length
          ? inArray(
              sessions.id,
              selected.map((target) => target.sessionId)
            )
          : sql`0`;
    const rows = db.orm
      .select()
      .from(sessions)
      .where(and(visible, filter))
      .orderBy(asc(sessions.id))
      .limit(limit)
      .offset(offset)
      .all();

    for (const session of rows)
      entries.push({
        target: { type: 'session', sessionId: session.id },
        title: session.title,
        text: session.title,
        sessionId: session.id,
        revision: session.updated_at.toString()
      });

    return entries;
  };
  /** Read complete active message versions while excluding archived messages and deleted sessions. */
  const messageEntries = (input: SearchProjectionPageInput): ConversationEntry[] => {
    const entries: ConversationEntry[] = [];
    const { offset, limit, targets } = input;
    const selected = targets?.filter((target) => target.type === 'message');
    const filter =
      selected === undefined
        ? undefined
        : selected.length
          ? sql`(${messages.id},${sessions.id},${message_versions.id}) IN (${sql.join(
              selected.map(
                (target) => sql`(${target.messageId},${target.sessionId},${target.versionId})`
              ),
              sql`,`
            )})`
          : sql`0`;
    const rows = db.orm
      .select({ message: messages, version: message_versions, session: sessions })
      .from(messages)
      .innerJoin(sessions, eq(sessions.id, messages.session_id))
      .innerJoin(message_versions, eq(message_versions.id, messages.active_version_id))
      .where(
        and(
          visible,
          filter,
          sql`${messages.archived_at} IS NULL AND ${message_versions.status} = 'complete'`
        )
      )
      .orderBy(asc(messages.id))
      .limit(limit)
      .offset(offset)
      .all();

    for (const { message, version, session } of rows)
      entries.push({
        target: {
          type: 'message',
          messageId: message.id,
          sessionId: session.id,
          versionId: version.id
        },
        title: session.title,
        text: version.text,
        sessionId: session.id,
        revision: version.id.toString()
      });

    return entries;
  };
  /** Attach batched project memberships without changing each message’s session identity. */
  const attachMemberships = (entries: ConversationEntry[]): readonly SearchProjection[] => {
    if (!entries.length) return [];

    const memberships = new Map<SessionId, ProjectId[]>();

    for (const link of db.orm
      .select()
      .from(project_sessions)
      .where(
        inArray(project_sessions.session_id, [...new Set(entries.map((entry) => entry.sessionId))])
      )
      .orderBy(asc(project_sessions.project_id))
      .all()) {
      const ids = memberships.get(link.session_id) ?? [];

      ids.push(link.project_id);
      memberships.set(link.session_id, ids);
    }

    return entries.map(({ sessionId, ...entry }) => ({
      ...entry,
      projectIds: memberships.get(sessionId) ?? []
    }));
  };

  return (
    input: SearchProjectionPageInput = { offset: 0, limit: 1000 }
  ): readonly SearchProjection[] => {
    const entries = [
      ...(input.kind === undefined || input.kind === 'session' ? sessionEntries(input) : []),
      ...(input.kind === undefined || input.kind === 'message' ? messageEntries(input) : [])
    ];

    return attachMemberships(entries);
  };
}

export const ConversationSearchStore = defineStore({
  name: 'ConversationSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makeConversationSearchProjections(resources), true)
      )
    },
    mutations: {}
  })
});
