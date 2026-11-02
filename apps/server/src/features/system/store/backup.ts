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
          const count = (query: string) =>
            Number(requireRow(db.orm.get<{ n: bigint }>(sql.raw(query))).n);

          return {
            materials: count('SELECT count(*) n FROM materials'),
            versions: count('SELECT count(*) n FROM material_versions'),
            documents: count('SELECT count(*) n FROM documents'),
            sources: count('SELECT count(*) n FROM sources'),
            collections: count('SELECT count(*) n FROM projects'),
            sessions: count('SELECT count(*) n FROM sessions'),
            annotations: count('SELECT count(*) n FROM material_annotations'),
            quizAttempts: count('SELECT count(*) n FROM material_quiz_attempts'),
            cardReviews: count('SELECT count(*) n FROM material_card_reviews'),
            practiceSlots: count('SELECT count(*) n FROM learning_practice_slots'),
            tombstones: count(
              'SELECT (SELECT count(*) FROM material_deletions) + (SELECT count(*) FROM session_deletions) n'
            ),
            historyPrunes: count('SELECT count(*) n FROM material_history_prunes'),
            prunedVersions: count('SELECT count(*) n FROM material_history_members')
          };
        }
      })
    },
    mutations: {}
  })
});
