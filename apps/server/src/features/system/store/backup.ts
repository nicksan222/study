/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Inspects application content scope for managed backup descriptors and deliberate   │
 * │ replacement previews.                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Counts retained content and durable deletion barriers without changing feature         │
 * │   records.                                                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services retain mutation authority; this System inventory reads supported SQLite │
 * │ tables only.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { backupScopeSchema } from '@study/contracts/system/backups';
import { sql } from '@study/db';
import type { SQL } from '@study/db';
import { Schema } from 'effect';

import { requireRow } from '#server/platform/database/rows';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

export const BackupScopeStore = defineStore({
  name: 'study/BackupScopeStore',
  entity: { singular: 'backupScope', plural: 'backupScopes' },
  make: ({ db }) => ({
    queries: {
      backupScope: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: backupScopeSchema,
        run: () => {
          const count = (query: SQL) => Number(requireRow(db.orm.get<{ n: bigint }>(query)).n);

          return {
            materials: count(sql`SELECT count(*) n FROM materials`),
            versions: count(sql`SELECT count(*) n FROM material_versions`),
            documents: count(sql`SELECT count(*) n FROM documents`),
            sources: count(sql`SELECT count(*) n FROM sources`),
            collections: count(sql`SELECT count(*) n FROM projects`),
            sessions: count(sql`SELECT count(*) n FROM sessions`),
            annotations: count(sql`SELECT count(*) n FROM material_annotations`),
            quizAttempts: count(sql`SELECT count(*) n FROM material_quiz_attempts`),
            cardReviews: count(sql`SELECT count(*) n FROM material_card_reviews`),
            practiceSlots: count(sql`SELECT count(*) n FROM learning_practice_slots`),
            tombstones: count(
              sql`SELECT (SELECT count(*) FROM material_deletions) + (SELECT count(*) FROM session_deletions) n`
            ),
            historyPrunes: count(sql`SELECT count(*) n FROM material_history_prunes`),
            prunedVersions: count(sql`SELECT count(*) n FROM material_history_members`)
          };
        }
      })
    },
    mutations: {}
  })
});
