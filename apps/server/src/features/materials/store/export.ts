/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads bounded retained dependency links and citation evidence for version exports. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Guards exact version availability before returning export aggregates.                  │
 * │ - Applies cumulative citation budgets with one cached canonical Document.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous stores perform database reads within the owning service transaction. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialVersionIdSchema } from '@study/contracts/ids';
import { MAX_EXPORT_BYTES } from '@study/contracts/materials/export';
import { materialCitationSchema } from '@study/contracts/materials/schemas';
import { and, asc, eq, gt } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { exportBudget } from '#server/platform/content-export/budget';
import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { makeCitations } from './citations.ts';
import { makeReads } from './reads.ts';

/** Resolves and budgets each citation before retaining it, with a one-Document cache. */
export const MaterialExportCitationsStore = defineStore({
  name: 'study/MaterialExportCitationsStore',
  entity: { singular: 'exportCitationSnapshot', plural: 'exportCitationSnapshots' },
  make: (resources) => ({
    queries: {
      exportCitationSnapshot: storeQuery({
        role: 'required',
        input: Schema.Struct({
          id: materialVersionIdSchema,
          budget: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_EXPORT_BYTES }))
        }),
        output: Schema.Struct({ citations: Schema.Array(materialCitationSchema) }),
        run: ({ id, budget }) => {
          const reads = makeReads(resources);

          reads.versionRow(id);
          const bytes = exportBudget(budget);
          const citations = makeCitations(resources);
          const result: (typeof materialCitationSchema.Type)[] = [];
          let cursor: bigint | undefined;

          for (;;) {
            const row = resources.db.orm
              .select()
              .from(s.material_evidence_citations)
              .where(
                and(
                  eq(s.material_evidence_citations.version_id, id),
                  cursor === undefined
                    ? undefined
                    : gt(s.material_evidence_citations.marker, cursor)
                )
              )
              .orderBy(asc(s.material_evidence_citations.marker))
              .limit(1)
              .get();

            if (!row) return { citations: result };

            if (result.length >= 10000)
              throw new StudyError('invalid_input', 'Export citation limit exceeded');

            const citation = citations.readCitationDetails(row);

            bytes.consume(citation);
            bytes.consume(null); // Reserve at least the array separator overhead.
            result.push(citation);
            cursor = row.marker;
          }
        }
      })
    },
    mutations: {}
  })
});
