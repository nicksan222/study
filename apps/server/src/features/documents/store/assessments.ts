/** Append-only user judgments remain distinct from citation location and truth. */
import * as c from '@study/contracts/documents/evidence';
import { and, desc, eq, lt } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const codec = Schema.fromJsonString(Schema.toCodecJson(c.assessmentSchema));
export const DocumentCitationAssessmentsStore = defineStore({
  name: 'study/DocumentCitationAssessmentsStore',
  entity: { singular: 'citationAssessment', plural: 'citationAssessments' },
  make: ({ db }) => ({
    queries: {
      citationAssessments: storeQuery({
        role: 'collection',
        input: c.assessmentsInputSchema,
        output: Schema.Struct({
          items: Schema.Array(c.assessmentRecordSchema),
          nextCursor: Schema.NullOr(Schema.BigInt)
        }),
        run: (value) => {
          const t = s.study_document_citation_assessments;
          const rows = db.orm
            .select()
            .from(t)
            .where(
              and(
                eq(t.version_id, value.versionId),
                value.marker === undefined ? undefined : eq(t.marker, BigInt(value.marker)),
                value.cursor === undefined ? undefined : lt(t.id, value.cursor)
              )
            )
            .orderBy(desc(t.id))
            .limit(value.limit + 1)
            .all();
          return {
            items: rows.slice(0, value.limit).map((row) => ({
              id: row.id,
              assessment: Schema.decodeUnknownSync(codec)(row.payload)
            })),
            nextCursor: rows.length > value.limit ? rows[value.limit - 1]!.id : null
          };
        }
      })
    },
    mutations: {
      assessCitation: storeMutation({
        input: c.assessmentSchema,
        output: c.assessmentRecordSchema,
        run: (assessment) => {
          const row = db.orm
            .insert(s.study_document_citation_assessments)
            .values({
              version_id: assessment.claim.range.versionId,
              marker: BigInt(assessment.marker),
              payload: Schema.encodeSync(codec)(assessment)
            })
            .returning()
            .get();
          return { id: row.id, assessment };
        }
      })
    }
  })
});
