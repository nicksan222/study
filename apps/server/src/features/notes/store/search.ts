/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Projects active completed messages and notes while respecting deletion             │
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

import type { ProjectId, NoteId } from '@study/contracts/ids';
import { NoteMode } from '@study/contracts/notes/schemas';
import type { SearchProjection, SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { and, asc, eq, inArray, sql } from '@study/db';
import { messages, message_versions, project_notes, notes } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { searchProjectionPageQuery } from '#server/platform/search/projection-page';

type NoteEntry = Omit<SearchProjection, 'projectIds'> & { noteId: NoteId };

/** Project visible notes and completed active message versions with canonical navigation targets. */
export function makeNoteSearchProjections({ db }: StoreResources) {
  const visible = and(
    eq(notes.mode, NoteMode.Notebook),
    sql`NOT EXISTS (SELECT 1 FROM note_deletions d WHERE d.note_id = ${notes.id})`
  );
  /** Page nondeleted note identities and titles without loading note contents. */
  const noteEntries = (input: SearchProjectionPageInput): NoteEntry[] => {
    const entries: NoteEntry[] = [];
    const { offset, limit, targets } = input;
    const selected = targets?.filter((target) => target.type === 'note');
    const filter =
      selected === undefined
        ? undefined
        : selected.length
          ? inArray(
              notes.id,
              selected.map((target) => target.noteId)
            )
          : sql`0`;
    const rows = db.orm
      .select()
      .from(notes)
      .where(and(visible, filter))
      .orderBy(asc(notes.id))
      .limit(limit)
      .offset(offset)
      .all();

    for (const note of rows)
      entries.push({
        target: { type: 'note', noteId: note.id },
        title: note.title,
        text: note.title,
        noteId: note.id,
        revision: note.updated_at.toString()
      });

    return entries;
  };
  /** Read complete active message versions while excluding archived messages and deleted notes. */
  const messageEntries = (input: SearchProjectionPageInput): NoteEntry[] => {
    const entries: NoteEntry[] = [];
    const { offset, limit, targets } = input;
    const selected = targets?.filter((target) => target.type === 'message');
    const filter =
      selected === undefined
        ? undefined
        : selected.length
          ? sql`(${messages.id},${notes.id},${message_versions.id}) IN (${sql.join(
              selected.map(
                (target) => sql`(${target.messageId},${target.noteId},${target.versionId})`
              ),
              sql`,`
            )})`
          : sql`0`;
    const rows = db.orm
      .select({ message: messages, version: message_versions, note: notes })
      .from(messages)
      .innerJoin(notes, eq(notes.id, messages.note_id))
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

    for (const { message, version, note } of rows)
      entries.push({
        target: {
          type: 'message',
          messageId: message.id,
          noteId: note.id,
          versionId: version.id
        },
        title: note.title,
        text: version.text,
        noteId: note.id,
        revision: version.id.toString()
      });

    return entries;
  };
  /** Attach batched project memberships without changing each message’s note identity. */
  const attachMemberships = (entries: NoteEntry[]): readonly SearchProjection[] => {
    if (!entries.length) return [];

    const memberships = new Map<NoteId, ProjectId[]>();

    for (const link of db.orm
      .select()
      .from(project_notes)
      .where(inArray(project_notes.note_id, [...new Set(entries.map((entry) => entry.noteId))]))
      .orderBy(asc(project_notes.project_id))
      .all()) {
      const ids = memberships.get(link.note_id) ?? [];

      ids.push(link.project_id);
      memberships.set(link.note_id, ids);
    }

    return entries.map(({ noteId, ...entry }) => ({
      ...entry,
      projectIds: memberships.get(noteId) ?? []
    }));
  };

  return (
    input: SearchProjectionPageInput = { offset: 0, limit: 1000 }
  ): readonly SearchProjection[] => {
    const entries = [
      ...(input.kind === undefined || input.kind === 'note' ? noteEntries(input) : []),
      ...(input.kind === undefined || input.kind === 'message' ? messageEntries(input) : [])
    ];

    return attachMemberships(entries);
  };
}

export const NoteSearchStore = defineStore({
  name: 'NoteSearch',
  entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
  make: (resources) => ({
    queries: {
      searchProjectionPages: storeQuery(
        searchProjectionPageQuery(makeNoteSearchProjections(resources), true)
      )
    },
    mutations: {}
  })
});
