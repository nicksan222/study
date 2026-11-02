/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ Reads bounded retained dependency links and citation evidence for version exports.       │
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
import { materialVersionInputSchema } from '@study/contracts/materials/rpc';
import { materialCitationSchema } from '@study/contracts/materials/schemas';
import { and, asc, eq, gt } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { exportBudget } from '../export-budget.ts';
import { makeCitations } from './citations.ts';
import { makeReads } from './reads.ts';

/** Availability and graph links without hydrating unrelated version content. */
export const MaterialExportInputsStore = defineStore({
  name: 'study/MaterialExportInputsStore',
  entity: { singular: 'exportInputGraph', plural: 'exportInputGraphs' },
  make: (resources) => ({
    queries: {
      exportInputGraph: storeQuery({
        role: 'required',
        input: materialVersionInputSchema,
        output: Schema.Struct({ ids: Schema.Array(materialVersionIdSchema) }),
        run: ({ id }) => {
          makeReads(resources).versionRow(id);
          const rows = resources.db.orm
            .select({ id: s.material_version_inputs.input_version_id })
            .from(s.material_version_inputs)
            .where(eq(s.material_version_inputs.version_id, id))
            .limit(1001)
            .all();
          if (rows.length > 1000)
            throw new StudyError('invalid_input', 'Export dependency limit exceeded');
          return { ids: rows.map((row) => row.id) };
        }
      })
    },
    mutations: {}
  })
});

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
          let cached:
            | {
                id: Parameters<typeof reads.readCanonicalDocument>[0];
                document: ReturnType<typeof reads.readCanonicalDocument>;
              }
            | undefined;
          const citations = makeCitations(resources, (documentId) => {
            if (cached?.id === documentId) return cached.document;
            // Release the prior document before loading another, keeping the cache bounded.
            cached = undefined;
            const document = reads.readCanonicalDocument(documentId);
            exportBudget().consume(document);
            cached = { id: documentId, document };
            return document;
          });
          const result: (typeof materialCitationSchema.Type)[] = [];
          let cursor: bigint | undefined;
          for (;;) {
            const row = resources.db.orm
              .select()
              .from(s.material_version_citations)
              .where(
                and(
                  eq(s.material_version_citations.version_id, id),
                  cursor === undefined ? undefined : gt(s.material_version_citations.marker, cursor)
                )
              )
              .orderBy(asc(s.material_version_citations.marker))
              .limit(1)
              .get();
            if (!row) return { citations: result };
            if (result.length >= 10000)
              throw new StudyError('invalid_input', 'Export citation limit exceeded');
            reads.versionRow(row.input_version_id);
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
