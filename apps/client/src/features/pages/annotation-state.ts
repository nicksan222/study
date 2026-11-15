import type { ErrorKind } from '@study/contracts/errors';
import type { PageAnnotationId } from '@study/contracts/ids';
import type { reviseAnnotationSchema } from '@study/contracts/pages/evidence';
import type { annotationSchema, annotationOutcomeSchema } from '@study/contracts/pages/evidence';

import type { Target } from './annotation-target';

export type Annotation = typeof annotationSchema.Type;

export type AnnotationDraft = {
  note: string;
  kind: Annotation['kind'];
  target?: Target;
  generation: number;
  current: Annotation;
  pending: boolean;
  uncertain: boolean;
  result?: typeof annotationOutcomeSchema.Type;
  review?: Annotation;
  error?: ErrorKind;
};

export function savedDraft(
  draft: AnnotationDraft,
  submitted: number,
  annotation: Annotation
): AnnotationDraft {
  return {
    ...draft,
    current: annotation,
    pending: false,
    uncertain: false,
    review: undefined,
    error: undefined,
    ...(draft.generation === submitted ? { note: annotation.note, kind: annotation.kind } : {})
  };
}

/** Retain known identities even if a later active-list page omits them. */
export function retainAnnotations(
  previous: readonly Annotation[],
  incoming: readonly Annotation[]
) {
  const known = new Map(previous.map((item) => [item.id, item]));

  for (const item of incoming) {
    const existing = known.get(item.id);

    if (!existing || item.revision >= existing.revision) known.set(item.id, item);
  }

  return [...known.values()];
}

export function annotationBlocked(draft: AnnotationDraft) {
  return (
    draft.pending ||
    draft.uncertain ||
    Boolean(draft.review) ||
    draft.current.deleted ||
    draft.result?.outcome === 'conflict'
  );
}

/** Revision inputs deliberately preserve unrelated drafts when reanchoring or deleting. */
export function annotationRevisionInput(
  id: PageAnnotationId,
  draft: AnnotationDraft,
  action: 'update' | 'reanchor' | 'delete'
): typeof reviseAnnotationSchema.Type | undefined {
  if (annotationBlocked(draft)) return undefined;

  const target = action === 'reanchor' ? draft.target : draft.current.target;

  if (!target) return undefined;

  return {
    id,
    expectedRevision: draft.current.revision,
    target,
    note: action === 'update' ? draft.note : draft.current.note,
    kind: action === 'update' ? draft.kind : draft.current.kind,
    deleted: action === 'delete'
  };
}

export function acknowledgedAnnotationDraft(
  draft: AnnotationDraft,
  outcome: typeof annotationOutcomeSchema.Type,
  submittedGeneration: number
): AnnotationDraft {
  if (outcome.outcome === 'saved')
    return { ...savedDraft(draft, submittedGeneration, outcome.annotation), result: outcome };

  return {
    ...draft,
    pending: false,
    result: outcome,
    review: outcome.outcome === 'conflict' ? outcome.annotation : undefined
  };
}
