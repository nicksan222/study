/** @file Owns evidence within this feature. */

import type * as evidence from '@study/contracts';
import { transaction, useStore } from '@study/server';

import {
  PageAnnotationHistoryStore,
  PageAnnotationsStore
} from '#server/features/pages/store/annotations';

import { assessCitation, citationAssessments } from './assessments.ts';
import { annotationChanged } from './publication.ts';

export function* pageEvidenceOperations() {
  const annotations = yield* useStore(PageAnnotationsStore);

  const annotationHistory = yield* useStore(PageAnnotationHistoryStore);

  return {
    assessCitation: (v: typeof evidence.assessCitationSchema.Type) =>
      transaction((tx) => assessCitation(tx, v)),
    assessments: (v: typeof evidence.assessmentsInputSchema.Type) =>
      transaction((tx) => citationAssessments(tx, v)),
    ...annotations,
    ...annotationHistory,
    createAnnotation: (v: typeof evidence.createAnnotationSchema.Type) =>
      transaction((tx) =>
        annotationChanged(tx, tx.store(PageAnnotationsStore).createAnnotation(v))
      ),
    reviseAnnotation: (v: typeof evidence.reviseAnnotationSchema.Type) =>
      transaction((tx) => annotationChanged(tx, tx.store(PageAnnotationsStore).reviseAnnotation(v)))
  };
}
