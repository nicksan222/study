import type {
  PageId,
  PageAnnotationId,
  PageVersionId,
  annotationOutcomeSchema,
  createAnnotationSchema,
  rangeSchema
} from '@study/contracts';
import { Atom } from 'effect/reactivity';

import type { Annotation, AnnotationDraft } from './annotation-state';

export type AnnotationCreation = {
  note: string;
  range?: typeof rangeSchema.Type;
  generation: number;
  busy: boolean;
  unresolved?: typeof createAnnotationSchema.Type;
  reviewed: boolean;
  outcome?: typeof annotationOutcomeSchema.Type;
};

/** Drafts are independent of server connection lifetime and acknowledge submitted generations. */
export const annotationCreations = Atom.family((_id: PageVersionId) =>
  Atom.make<AnnotationCreation>({ note: '', generation: 0, busy: false, reviewed: false }).pipe(
    Atom.keepAlive
  )
);

export const annotationDrafts = Atom.family((_id: PageAnnotationId) =>
  Atom.make<AnnotationDraft | undefined>(undefined).pipe(Atom.keepAlive)
);

/** Known identities support explicit review of an uncertain creation without replaying it. */
export const annotationCandidates = Atom.family((_pageId: PageId) =>
  Atom.make<readonly Annotation[]>([]).pipe(Atom.keepAlive)
);
