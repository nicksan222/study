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

import { StudyError } from '@study/contracts/errors';
import { materialIdSchema, pageIdSchema, sourceIdSchema, noteIdSchema } from '@study/contracts/ids';
import { selectionTargetsSchema } from '@study/contracts/notes/context';
import { copyNoteContentSchema } from '@study/contracts/notes/notes';
import { mergeNotesInputSchema } from '@study/contracts/notes/rpc';
import { NoteMode } from '@study/contracts/notes/schemas';
import { and, asc, eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { copyMessagesInputSchema, makeMessageCopy } from './message-copy.ts';

export const NoteMergeStore = defineStore({
  name: 'study/NoteMergeStore',
  entity: { singular: 'noteMerge', plural: 'noteMerges' },
  make: (resources) => ({
    queries: {
      noteMerge: storeQuery({
        role: 'required',
        input: copyNoteContentSchema.fields.noteIds,
        output: Schema.Struct({
          pages: Schema.Array(
            Schema.Struct({ id: pageIdSchema, archivedAt: Schema.NullOr(Schema.BigInt) })
          ),
          sources: Schema.Array(
            Schema.Struct({ id: sourceIdSchema, archivedAt: Schema.NullOr(Schema.BigInt) })
          ),
          materials: Schema.Array(materialIdSchema)
        }),
        run: (ids) => ({
          pages: resources.db.orm
            .select({
              id: s.note_pages.page_id,
              archivedAt: s.note_pages.archived_at
            })
            .from(s.note_pages)
            .where(inArray(s.note_pages.note_id, ids))
            .orderBy(asc(s.note_pages.note_id), asc(s.note_pages.position))
            .all(),
          sources: resources.db.orm
            .select({ id: s.note_sources.source_id, archivedAt: s.note_sources.archived_at })
            .from(s.note_sources)
            .where(inArray(s.note_sources.note_id, ids))
            .orderBy(asc(s.note_sources.note_id), asc(s.note_sources.position))
            .all(),
          materials: resources.db.orm
            .select({ id: s.note_materials.material_id })
            .from(s.note_materials)
            .where(inArray(s.note_materials.note_id, ids))
            .orderBy(asc(s.note_materials.note_id), asc(s.note_materials.position))
            .all()
            .map((row) => row.id)
        })
      })
    },
    mutations: {
      copyMessages: storeMutation({
        input: copyMessagesInputSchema,
        output: Schema.Void,
        run: makeMessageCopy(resources)
      }),
      merge: storeMutation({
        input: mergeNotesInputSchema,
        output: Schema.Struct({ id: noteIdSchema, created: Schema.Boolean }),
        run: ({ noteIds, intentKey }) => {
          const { db, clock } = resources;
          const ids = distinctNoteIds(noteIds);

          const intent = JSON.stringify(ids.map(String));
          const receipt = db.orm
            .select()
            .from(s.note_merges)
            .where(eq(s.note_merges.intent_key, intentKey))
            .get();

          if (receipt) {
            if (receipt.note_ids !== intent)
              throw new StudyError('invalid_input', 'Merge intent changed');

            return { id: receipt.note_id, created: false };
          }

          const originals = db.orm.select().from(s.notes).where(inArray(s.notes.id, ids)).all();

          if (originals.length !== ids.length) throw new StudyError('not_found', 'Note not found');

          if (originals.some((row) => row.mode !== NoteMode.Notebook || row.archived_at !== null))
            throw new StudyError('invalid_input', 'Only active notebook notes can be merged');

          if (
            db.orm
              .select()
              .from(s.note_deletions)
              .where(inArray(s.note_deletions.note_id, ids))
              .get()
          )
            throw new StudyError('invalid_input', 'Note deletion is in progress');

          if (
            db.orm
              .select()
              .from(s.page_transform_requests)
              .where(
                and(
                  inArray(s.page_transform_requests.note_id, ids),
                  eq(s.page_transform_requests.cancelled, false),
                  sql`${s.page_transform_requests.result_version_id} IS NULL`
                )
              )
              .get()
          )
            throw new StudyError(
              'invalid_input',
              'Finish or cancel page generation before merging'
            );

          const decode = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
          );
          const selections = [
            ...new Map(
              originals
                .flatMap((row) => decode(row.selection))
                .map((target) => [
                  JSON.stringify(target, (_key, value) =>
                    typeof value === 'bigint' ? String(value) : value
                  ),
                  target
                ])
            ).values()
          ];

          if (selections.length > 20)
            throw new StudyError('invalid_input', 'Too many selected inputs to merge');

          const selection = Schema.encodeSync(
            Schema.fromJsonString(Schema.toCodecJson(selectionTargetsSchema))
          )(selections);
          const now = unixSeconds(clock);
          const created = db.orm
            .insert(s.notes)
            .values({
              title: [...originals.map((row) => row.title).join(' · ')].slice(0, 200).join(''),
              selection,
              title_source: 'provisional',
              created_at: now,
              updated_at: now
            })
            .returning()
            .get();

          for (const link of db.orm
            .select()
            .from(s.project_notes)
            .where(inArray(s.project_notes.note_id, ids))
            .all())
            db.orm
              .insert(s.project_notes)
              .values({ ...link, note_id: created.id })
              .onConflictDoNothing()
              .run();

          db.orm.update(s.notes).set({ archived_at: now }).where(inArray(s.notes.id, ids)).run();
          db.orm
            .insert(s.note_merges)
            .values({ intent_key: intentKey, note_ids: intent, note_id: created.id })
            .run();

          return { id: created.id, created: true };
        }
      })
    }
  })
});

function distinctNoteIds(noteIds: (typeof mergeNotesInputSchema.Type)['noteIds']) {
  const ids = [...new Set(noteIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (ids.length < 2 || ids.length !== noteIds.length)
    throw new StudyError('invalid_input', 'Select distinct notes to merge');

  return ids;
}
