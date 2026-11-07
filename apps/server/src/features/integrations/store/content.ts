/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads individual staged notes and their referenced original file snapshots.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Bounds publication reads to the current note and its attachments.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store operations retain shared Source receipts inside the publication transaction. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sourceIdSchema } from '@study/contracts/ids';
import {
  integrationImportIdSchema,
  integrationSessionSchema
} from '@study/contracts/integrations/schemas';
import { and, eq, inArray } from '@study/db';
import { integration_import_notes, integration_import_files } from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const keySchema = Schema.Struct({ id: integrationImportIdSchema, key: Schema.String });

const noteSchema = Schema.Struct({ note: integrationSessionSchema, fingerprint: Schema.String });

const noteJson = Schema.fromJsonString(integrationSessionSchema);

const contentSchema = Schema.Struct({
  ...noteSchema.fields,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      content: Schema.String,
      sourceId: Schema.NullOr(sourceIdSchema)
    })
  )
});

function stagedNote(db: StoreResources['db'], input: typeof keySchema.Type) {
  const row = db.orm
    .select()
    .from(integration_import_notes)
    .where(
      and(
        eq(integration_import_notes.import_id, input.id),
        eq(integration_import_notes.key, input.key)
      )
    )
    .get();

  return row
    ? { note: Schema.decodeUnknownSync(noteJson)(row.payload), fingerprint: row.fingerprint }
    : null;
}

export const IntegrationNotesStore = defineStore({
  name: 'study/IntegrationNotesStore',
  entity: { singular: 'integrationNote', plural: 'integrationNotes' },
  make: ({ db }) => ({
    mutations: {},
    queries: {
      integrationNote: storeQuery({
        role: 'required',
        input: keySchema,
        output: noteSchema,
        run: ({ id, key }) => {
          return stagedNote(db, { id, key });
        }
      })
    }
  })
});

export const IntegrationContentStore = defineStore({
  name: 'study/IntegrationContentStore',
  entity: { singular: 'integrationContent', plural: 'integrationContents' },
  make: ({ db }) => ({
    queries: {
      integrationContent: storeQuery({
        role: 'required',
        input: keySchema,
        output: contentSchema,
        run: ({ id, key }) => {
          const staged = stagedNote(db, { id, key });

          if (!staged) return null;

          const { note, fingerprint } = staged;
          const files = db.orm
            .select()
            .from(integration_import_files)
            .where(
              and(
                eq(integration_import_files.import_id, id),
                inArray(integration_import_files.path, [note.key, ...note.attachments])
              )
            )
            .all();

          return {
            note,
            fingerprint,
            files: files.map((file) => ({
              path: file.path,
              content: file.content,
              sourceId: file.source_id
            }))
          };
        }
      })
    },
    mutations: {
      retainSource: storeMutation({
        input: Schema.Struct({
          id: integrationImportIdSchema,
          path: Schema.String,
          sourceId: sourceIdSchema
        }),
        output: Schema.Void,
        run: ({ id, path, sourceId }) => {
          db.orm
            .update(integration_import_files)
            .set({ source_id: sourceId })
            .where(
              and(
                eq(integration_import_files.import_id, id),
                eq(integration_import_files.path, path)
              )
            )
            .run();
        }
      })
    }
  })
});
