/** @file Builds materials citations queries and mutations with bound store resources. */

import * as input from '@study/contracts';
import * as tables from '@study/db';
import { and, asc, eq, gt } from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { makeCitations } from './citation-operations.ts';
import { makeReads } from './reads.ts';

export function makeMaterialCitationsStore(resources: StoreResources) {
  const { db } = resources;
  const { readCitationDetails } = makeCitations(resources);

  const { versionRow } = makeReads(resources);

  return {
    queries: {
      citations: storeQuery({
        role: 'collection',
        input: input.citationsInputSchema,
        output: input.citationPageSchema,
        run: (value) => {
          versionRow(value.id);

          const rows = db.orm
            .select()
            .from(tables.material_evidence_citations)
            .where(
              and(
                eq(tables.material_evidence_citations.version_id, value.id),
                value.cursor === undefined
                  ? undefined
                  : gt(tables.material_evidence_citations.marker, value.cursor)
              )
            )
            .orderBy(asc(tables.material_evidence_citations.marker))
            .limit(value.limit + 1)
            .all();

          const items = rows.slice(0, value.limit).map(readCitationDetails);

          return { items, nextCursor: rows.length > value.limit ? items.at(-1)!.marker : null };
        }
      })
    },
    mutations: {}
  };
}
