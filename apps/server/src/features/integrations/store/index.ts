/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists validated import plans and recoverable progress in SQLite.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns staged transfer inputs and import progress.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Workflow owns execution while these typed operations own integration persistence.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  integrationImportIdSchema,
  integrationImportSchema,
  integrationPlanSchema
} from '@study/contracts/integrations/schemas';
import { desc, eq } from '@study/db';
import {
  integration_imports,
  integration_import_notes,
  integration_import_files,
  projects
} from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const stagedImportSchema = Schema.Struct({
  state: integrationImportSchema,
  plan: integrationPlanSchema,
  fingerprints: Schema.Record(Schema.String, Schema.String)
});

const stateJson = Schema.fromJsonString(Schema.toCodecJson(integrationImportSchema));

export const IntegrationImportsStore = defineStore({
  name: 'study/IntegrationImportsStore',
  entity: { singular: 'integrationImport', plural: 'integrationImports' },
  make: ({ db, clock }) => ({
    queries: {
      integrationImport: storeQuery({
        role: 'required',
        input: integrationImportIdSchema,
        output: integrationImportSchema,
        run: (id) => {
          const row = db.orm
            .select({ state: integration_imports.state })
            .from(integration_imports)
            .where(eq(integration_imports.id, id))
            .get();

          return row ? Schema.decodeUnknownSync(stateJson)(row.state) : null;
        }
      }),
      integrationImports: storeQuery({
        role: 'collection',
        input: Schema.Struct({
          limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
        }),
        output: Schema.Array(integrationImportSchema),
        run: ({ limit }) =>
          db.orm
            .select({ state: integration_imports.state })
            .from(integration_imports)
            .orderBy(desc(integration_imports.created_at), desc(integration_imports.id))
            .limit(limit)
            .all()
            .map((row) => Schema.decodeUnknownSync(stateJson)(row.state))
      })
    },
    mutations: {
      stage: storeMutation({
        input: stagedImportSchema,
        output: Schema.Void,
        run: ({ state, plan, fingerprints }) => {
          db.orm
            .insert(integration_imports)
            .values({
              id: state.id,
              provider_id: state.providerId,
              source_key: state.sourceKey,
              project_id: state.projectId,
              state: Schema.encodeSync(stateJson)(state),
              created_at: clock.currentTimeMillisUnsafe()
            })
            .run();

          for (const note of plan.sessions)
            db.orm
              .insert(integration_import_notes)
              .values({
                import_id: state.id,
                key: note.key,
                payload: JSON.stringify(note),
                fingerprint: fingerprints[note.key]!
              })
              .run();

          for (const file of plan.files)
            db.orm
              .insert(integration_import_files)
              .values({ import_id: state.id, path: file.path, content: file.content })
              .run();
        }
      }),
      progress: storeMutation({
        input: integrationImportSchema,
        output: Schema.Void,
        run: (state) => {
          // The chosen scope stays immutable in the receipt; this FK tracks only a live project.
          const projectId =
            state.projectId === null
              ? null
              : (db.orm
                  .select({ id: projects.id })
                  .from(projects)
                  .where(eq(projects.id, state.projectId))
                  .get()?.id ?? null);

          db.orm
            .update(integration_imports)
            .set({ state: Schema.encodeSync(stateJson)(state), project_id: projectId })
            .where(eq(integration_imports.id, state.id))
            .run();
        }
      })
    }
  })
});
