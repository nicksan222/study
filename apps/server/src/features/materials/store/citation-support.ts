/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Pins manual user assessments to exact claim and evidence revisions.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reports conservative invalidation independently of unchanged historic navigation.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ User judgments are not independent verification and never invoke model providers.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import * as contract from '@study/contracts/materials/evidence';
import { and, desc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { readCitation } from './citation-row.ts';
import { makeEvidence } from './evidence.ts';

const codec = Schema.fromJsonString(Schema.toCodecJson(contract.citationAssessmentSchema));
const citationEqual = Schema.toEquivalence(contract.citationAssessmentSchema.fields.citation);

export function makeSupport(resources: StoreResources) {
  const { db } = resources;
  const resolver = makeEvidence(resources);
  function citationAt(
    versionId: typeof contract.citationSupportInputSchema.Type.versionId,
    marker: bigint
  ) {
    const row = db.orm
      .select()
      .from(s.material_version_citations)
      .where(
        and(
          eq(s.material_version_citations.version_id, versionId),
          eq(s.material_version_citations.marker, marker)
        )
      )
      .get();

    return row ? readCitation(row) : null;
  }

  function support(
    value: typeof contract.citationSupportInputSchema.Type
  ): typeof contract.citationSupportSchema.Type {
    const row = db.orm
      .select()
      .from(s.material_citation_assessments)
      .where(
        and(
          eq(s.material_citation_assessments.claim_version_id, value.versionId),
          eq(s.material_citation_assessments.marker, value.marker)
        )
      )
      .orderBy(desc(s.material_citation_assessments.id))
      .get();

    if (!row) return { state: 'unassessed' };

    const assessment = Schema.decodeUnknownSync(codec)(row.payload);
    const claim = resolver.resolve({ kind: 'range', target: assessment.claim });
    const evidence = resolver.resolve({ kind: 'range', target: assessment.evidence });
    const reasons: Extract<
      typeof contract.citationSupportSchema.Type,
      { assessment: unknown }
    >['reasons'][number][] = [];
    const citation = citationAt(value.versionId, value.marker);

    if (claim.availability === 'unavailable' || evidence.availability === 'unavailable')
      reasons.push('target_unavailable');
    if (claim.availability === 'available' && claim.revision.state !== 'current')
      reasons.push('claim_changed');
    if (evidence.availability === 'available' && evidence.revision.state !== 'current')
      reasons.push('evidence_changed');
    if (
      !citation?.target ||
      citation.inputVersionId !== assessment.evidence.range.versionId ||
      !citationEqual(
        { anchor: citation.anchor, quote: citation.quote, target: citation.target },
        assessment.citation
      )
    )
      reasons.push('citation_changed');

    return {
      state: reasons.includes('target_unavailable')
        ? 'unavailable'
        : reasons.length
          ? 'stale'
          : 'assessed',
      assessment,
      claim,
      evidence,
      reasons
    };
  }

  function assess(
    value: typeof contract.assessCitationSchema.Type
  ): typeof contract.citationSupportSchema.Type {
    const claim = resolver.resolve({ kind: 'range', target: value.claim });
    const evidence = resolver.resolve({ kind: 'range', target: value.evidence });

    if (claim.availability !== 'available' || evidence.availability !== 'available')
      throw new StudyError('invalid_input', 'Assessment requires available exact targets');

    const citation = citationAt(value.claim.range.versionId, value.marker);
    const rangeEqual = Schema.toEquivalence(contract.evidenceTargetSchema.fields.range);

    if (
      !citation?.target ||
      citation.inputVersionId !== value.evidence.range.versionId ||
      !rangeEqual(citation.target, value.evidence.range)
    )
      throw new StudyError(
        'invalid_input',
        'Assessment evidence must equal the exact citation target'
      );

    const assessment: typeof contract.citationAssessmentSchema.Type = {
      ...value,
      suppliedBy: 'user',
      independentVerification: false,
      citation: { anchor: citation.anchor, quote: citation.quote, target: citation.target }
    };

    db.orm
      .insert(s.material_citation_assessments)
      .values({
        claim_version_id: value.claim.range.versionId,
        evidence_version_id: value.evidence.range.versionId,
        marker: value.marker,
        payload: Schema.encodeSync(codec)(assessment)
      })
      .run();

    return support({ versionId: value.claim.range.versionId, marker: value.marker });
  }

  return { support, assess };
}

export const CitationSupportStore = defineStore({
  name: 'study/CitationSupportStore',
  entity: { singular: 'citationSupport', plural: 'citationSupports' },
  make: (resources) => {
    const actions = makeSupport(resources);

    return {
      queries: {
        citationSupport: storeQuery({
          role: 'required',
          input: contract.citationSupportInputSchema,
          output: contract.citationSupportSchema,
          run: actions.support
        })
      },
      mutations: {
        assessCitation: storeMutation({
          input: contract.assessCitationSchema,
          output: contract.citationSupportSchema,
          run: actions.assess
        })
      }
    };
  }
});
