/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates user citation judgments against exact claim and evidence ranges.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates user citation judgments against exact claim and evidence ranges.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import * as c from '@study/contracts/pages/evidence';
import { citationSchema, exactInputSchema } from '@study/contracts/pages/schemas';
import type { ExactPageInput } from '@study/contracts/pages/types';
import { Schema } from 'effect';

import { validRange } from '#server/features/pages/decoders/range';
import { PageCitationAssessmentsStore } from '#server/features/pages/store/assessments';
import { PagesStore, PageVersionsStore } from '#server/features/pages/store/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

function evidenceBody(tx: Transaction, input: ExactPageInput) {
  if (input.kind === 'page') {
    const version = tx.store(PageVersionsStore).version({ id: input.versionId });

    if (version.status === 'published') return version.document;
  }

  if (input.kind === 'source' && input.snapshotId !== null)
    return Sources.extractionInTransaction(tx, { ...input, snapshotId: input.snapshotId }).document;

  throw new StudyError('invalid_input', 'Citation assessment requires retained canonical evidence');
}

function claimVersion(tx: Transaction, target: typeof c.annotationTargetSchema.Type) {
  const v = tx.store(PageVersionsStore).version({ id: target.range.versionId });

  if (
    v.status !== 'published' ||
    v.pageId !== target.pageId ||
    v.snapshotId !== target.range.snapshotId ||
    !validRange(v.document, target.range)
  )
    throw new StudyError('invalid_input', 'Assessment claim requires an exact authored passage');

  return v;
}

export function assessCitation(tx: Transaction, value: typeof c.assessCitationSchema.Type) {
  const claim = claimVersion(tx, value.claim);
  const citation = claim.citations.find((citation) => citation.marker === value.marker);

  if (
    !citation ||
    citation.target === null ||
    !Schema.toEquivalence(c.assessmentSchema.fields.evidenceRange)(
      citation.target,
      value.evidenceRange
    ) ||
    !Schema.toEquivalence(exactInputSchema)(citation.input, value.evidence) ||
    !validRange(evidenceBody(tx, value.evidence), value.evidenceRange, citation.quote)
  )
    throw new StudyError('invalid_input', 'Assessment evidence must match the exact cited passage');

  return tx
    .store(PageCitationAssessmentsStore)
    .assessCitation({ ...value, citation, suppliedBy: 'user', independentVerification: false });
}

function evidenceIsCurrent(tx: Transaction, input: ExactPageInput) {
  if (input.kind === 'page') {
    const version = tx.store(PageVersionsStore).version({ id: input.versionId });

    return tx.store(PagesStore).page({ id: version.pageId }).headVersionId === version.id;
  }

  if (input.kind === 'source') {
    const current = Sources.currentExtractionInTransaction(tx, input.sourceId);

    return (
      !!current && current.revision === input.revision && current.snapshotId === input.snapshotId
    );
  }

  return true;
}

function assessmentState(tx: Transaction, assessment: typeof c.assessmentSchema.Type) {
  try {
    const claim = claimVersion(tx, assessment.claim);
    const citation = claim.citations.find((citation) => citation.marker === assessment.marker);

    if (!citation || !Schema.toEquivalence(citationSchema)(citation, assessment.citation))
      return 'stale' as const;

    if (
      !validRange(
        evidenceBody(tx, assessment.evidence),
        assessment.evidenceRange,
        assessment.citation.quote
      )
    )
      return 'stale' as const;

    const owner = tx.store(PagesStore).page({ id: claim.pageId });

    if (owner.headVersionId !== claim.id) return 'stale' as const;

    if (!evidenceIsCurrent(tx, assessment.evidence)) return 'stale' as const;

    return 'assessed' as const;
  } catch (error) {
    if (
      error instanceof StudyError &&
      (error.kind === 'not_found' || error.kind === 'invalid_input')
    )
      return 'unavailable' as const;

    throw error;
  }
}

export function citationAssessments(tx: Transaction, value: typeof c.assessmentsInputSchema.Type) {
  tx.store(PageVersionsStore).version({ id: value.versionId });
  const page = tx.store(PageCitationAssessmentsStore).citationAssessments(value);

  return {
    ...page,
    items: page.items.map((record) => ({
      ...record,
      state: assessmentState(tx, record.assessment)
    }))
  };
}
