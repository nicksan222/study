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

import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import {
  annotationRevisionSchema,
  citationAssessmentSchema
} from '@study/contracts/materials/evidence';
import {
  materialVersionDetailSchema,
  materialGenerationPayloadSchema
} from '@study/contracts/materials/schemas';
import { and, eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { makeReads } from './reads.ts';
import { decodeSourceSnapshot } from './source-snapshot.ts';

export const MaterialBackupStore = defineStore({
  name: 'study/MaterialBackupStore',
  entity: { singular: 'backupValidation', plural: 'backupValidations' },
  make: (resources) => ({
    queries: {
      backupValidation: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Boolean,
        run: () => {
          const { db } = resources;
          if (
            db.orm.get(
              sql`SELECT 1 FROM material_deletions WHERE status != 'completed' UNION ALL SELECT 1 FROM material_history_prunes WHERE status != 'completed' LIMIT 1`
            )
          )
            throw new StudyError('invalid_input', 'Backup requires completed cleanup');
          if (
            db.orm.get(
              sql`SELECT 1 FROM material_generation_requests WHERE cancelled=0 AND result_version_id IS NULL AND payload != '{}' LIMIT 1`
            )
          )
            throw new StudyError('invalid_input', 'Backup contains pending generation authority');
          const generation = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
          );
          for (const row of db.orm.select().from(s.material_generation_requests).all())
            if (row.payload !== '{}') generation(row.payload);
          for (const pin of db.orm.select().from(s.material_source_snapshots).all()) {
            const metadata = decodeSourceSnapshot(pin.metadata);
            const blob = db.orm
              .select()
              .from(s.source_snapshots)
              .where(
                and(
                  eq(s.source_snapshots.source_id, pin.source_id),
                  eq(s.source_snapshots.revision, pin.revision)
                )
              )
              .get();
            if (
              !blob ||
              metadata.id !== pin.source_id ||
              metadata.sizeBytes !== BigInt(blob.bytes.length) ||
              !createHash('sha256').update(blob.bytes).digest().equals(Buffer.from(metadata.sha256))
            )
              throw new StudyError('invalid_input', 'Backup pinned source bytes are incomplete');
          }
          const reads = makeReads(resources);
          for (const row of db.orm.select().from(s.documents).all())
            reads.readCanonicalDocument(row.id);
          for (const version of db.orm.select().from(s.material_versions).all()) {
            if (
              db.orm.get(
                sql`SELECT 1 FROM material_deletion_members WHERE material_id=${version.material_id} UNION ALL SELECT 1 FROM material_history_members WHERE version_id=${version.id} LIMIT 1`
              )
            )
              continue;
            Schema.decodeUnknownSync(materialVersionDetailSchema)(reads.readVersion(version.id));
          }
          const annotation = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(annotationRevisionSchema))
          );
          for (const row of db.orm.select().from(s.material_annotation_revisions).all())
            annotation(row.payload);
          const assessment = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.toCodecJson(citationAssessmentSchema))
          );
          for (const row of db.orm.select().from(s.material_citation_assessments).all())
            assessment(row.payload);
          return true;
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
