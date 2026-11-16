/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates canonical retained Material payloads and inventories unfinished          │
 * │ generation requests for backup preparation.                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks Document, version, annotation and assessment payloads through owning codecs.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials owns availability and payload interpretation; snapshot preparation never       │
 * │ writes live content.                                                                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import { contentInputSchema } from '@study/contracts';
import { learningCitationSchema } from '@study/contracts';
import { materialVersionDetailSchema, materialGenerationPayloadSchema } from '@study/contracts';
import { sql } from '@study/db';
import * as s from '@study/db';
import { defineStore, storeQuery } from '@study/server';
import { Schema } from 'effect';

import { makeExactInputs } from './exact-inputs.ts';
import { makeReads } from './reads.ts';

export const MaterialBackupStore = defineStore({
  name: 'study/MaterialBackupStore',
  entity: { singular: 'backupValidation', plural: 'backupValidations' },
  make: (resources) => ({
    queries: {
      backupValidation: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Array(
          Schema.Struct({
            inputs: Schema.Array(contentInputSchema),
            citations: Schema.Array(learningCitationSchema)
          })
        ),
        run: () => {
          const { db } = resources;

          if (
            db.orm.get(
              sql`SELECT 1 FROM material_deletions WHERE status!='completed' UNION ALL SELECT 1 FROM material_history_prunes WHERE status!='completed' LIMIT 1`
            )
          )
            throw new StudyError('invalid_input', 'Backup requires completed learning cleanup');

          const generation = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
          );

          for (const row of db.orm.select().from(s.material_generation_requests).all())
            if (row.payload !== '{}') generation(row.payload);

          const reads = makeReads(resources);
          const evidence = makeExactInputs(resources);
          const result = [];

          for (const row of db.orm.select().from(s.material_versions).all()) {
            if (
              db.orm.get(
                sql`SELECT 1 FROM material_deletion_members WHERE material_id=${row.material_id} UNION ALL SELECT 1 FROM material_history_members WHERE version_id=${row.id} LIMIT 1`
              )
            )
              continue;

            const version = Schema.decodeUnknownSync(materialVersionDetailSchema)(
              reads.readVersion(row.id)
            );

            result.push({ inputs: version.inputs, citations: evidence.citations(row.id) });
          }

          return result;
        }
      })
    },
    mutations: {}
  })
});
