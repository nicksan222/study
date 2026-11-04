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

import { StudyError } from '@study/contracts/errors';
import { contentInputSchema } from '@study/contracts/inputs';
import { learningCitationSchema } from '@study/contracts/materials/inputs';
import {
  materialVersionDetailSchema,
  materialGenerationPayloadSchema
} from '@study/contracts/materials/schemas';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

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

          if (
            db.orm.get(
              sql`SELECT 1 FROM material_generation_requests WHERE cancelled=0 AND result_version_id IS NULL AND payload!='{}' LIMIT 1`
            )
          )
            throw new StudyError('invalid_input', 'Backup contains pending learning authority');

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

export const MaterialPendingBackupStore = defineStore({
  name: 'study/MaterialPendingBackupStore',
  entity: { singular: 'pendingGenerations', plural: 'pendingGenerationBatches' },
  make: ({ db }) => ({
    queries: {
      pendingGenerations: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Array(Schema.String),
        run: () =>
          db.orm
            .select()
            .from(s.material_generation_requests)
            .all()
            .filter(
              (row) => row.result_version_id === null && !row.cancelled && row.payload !== '{}'
            )
            .map((row) => row.id)
      })
    },
    mutations: {}
  })
});
