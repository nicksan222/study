import type { ErrorKind } from '@study/contracts/errors';
import type {
  annotationSchema,
  annotationOutcomeSchema
} from '@study/contracts/materials/evidence';

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
