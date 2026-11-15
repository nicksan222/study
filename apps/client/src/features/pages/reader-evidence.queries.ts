import { RegistryContext, useAtom } from '@effect/atom-react';
import type {
  PageAnnotationId,
  annotationSchema,
  createAnnotationSchema,
  rangeSchema,
  PageVersion
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useContext, useEffect, useState } from 'react';

import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';

import { annotationCreations, annotationCandidates } from './annotation-drafts';
import type { AnnotationCreation } from './annotation-drafts';
import { retainAnnotations } from './annotation-state';

function matchesCreation(
  item: typeof annotationSchema.Type,
  unresolved: typeof createAnnotationSchema.Type
) {
  return (
    !item.deleted &&
    item.note === unresolved.note &&
    item.kind === unresolved.kind &&
    item.target.pageId === unresolved.target.pageId &&
    sameRange(item.target.range, unresolved.target.range)
  );
}

function sameRange(left: typeof rangeSchema.Type, right: typeof rangeSchema.Type) {
  return (
    left.versionId === right.versionId &&
    left.snapshotId === right.snapshotId &&
    left.blockId === right.blockId &&
    left.start === right.start &&
    left.end === right.end
  );
}

export function useReaderEvidence(version: PageVersion) {
  const registry = useContext(RegistryContext);
  const [open, setOpen] = useState(false);
  const creationAtom = annotationCreations(version.id);
  const [creation, setCreation] = useAtom(creationAtom);
  const [retained, setRetained] = useAtom(annotationCandidates(version.pageId));
  const { note, range, busy, unresolved, reviewed, outcome } = creation;

  function change(next: Partial<AnnotationCreation>) {
    setCreation((old) => ({ ...old, ...next, generation: old.generation + 1 }));
  }

  const citations = rpc.pages.version.useQuery({ id: version.id }, { enabled: open });
  const assessmentWindow = useCursorWindow<bigint>(String(version.id));
  const assessmentsLimit = assessmentWindow.limit;
  const assessments = rpc.pages.assessments.useQuery(
    { versionId: version.id, limit: assessmentsLimit, cursor: assessmentWindow.cursor },
    { enabled: open }
  );

  useCursorRecovery(assessmentWindow, assessments.error);
  const annotationWindow = useCursorWindow<PageAnnotationId>(String(version.pageId));
  const annotationsLimit = annotationWindow.limit;
  const annotations = rpc.pages.annotations.useQuery(
    {
      pageId: version.pageId,
      limit: annotationsLimit,
      cursor: annotationWindow.cursor,
      includeDeleted: true
    },
    { enabled: open }
  );

  useCursorRecovery(annotationWindow, annotations.error);

  useEffect(() => {
    const items = annotations.data?.items;

    if (items) setRetained((old) => retainAnnotations(old, items));
  }, [annotations.data, setRetained]);
  const possibleMatches = unresolved
    ? retained.filter((item) => matchesCreation(item, unresolved))
    : [];

  async function saveAnnotation() {
    const submitted = registry.get(creationAtom);

    if (!submitted.range || submitted.busy || submitted.unresolved) return;

    const input = {
      target: { pageId: version.pageId, range: submitted.range },
      kind: submitted.note.trim() ? ('note' as const) : ('highlight' as const),
      note: submitted.note
    };

    setCreation({ ...submitted, busy: true, reviewed: false, outcome: undefined });

    try {
      const result = await rpc.pages.createAnnotation.call(input);

      setCreation((old) => ({
        ...old,
        outcome: result,
        ...(result.outcome === 'saved' && old.generation === submitted.generation
          ? { range: undefined, note: '' }
          : {})
      }));

      if (result.outcome === 'saved')
        setRetained((old) => retainAnnotations(old, [result.annotation]));
    } catch {
      setCreation((old) => ({ ...old, unresolved: input, reviewed: false }));
    } finally {
      setCreation((old) => ({ ...old, busy: false }));
    }
  }

  async function refreshCreation() {
    try {
      const result = await rpc.pages.annotations.read({
        pageId: version.pageId,
        limit: annotationsLimit,
        cursor: annotationWindow.cursor,
        includeDeleted: true
      });

      setRetained((old) => retainAnnotations(old, result.items));
      setCreation((old) => ({ ...old, reviewed: !old.busy && result.nextCursor === null }));
      annotations.retry();
    } catch {
      setCreation((old) => ({ ...old, reviewed: false }));
    }
  }

  function acknowledgeCreation() {
    setCreation((old) =>
      !old.busy && old.reviewed ? { ...old, unresolved: undefined, reviewed: false } : old
    );
  }

  const visible = annotations.data?.items ?? [];
  const visibleIds = new Set(visible.map((item) => item.id));
  const allAnnotations = [...visible, ...retained.filter((item) => !visibleIds.has(item.id))];

  return {
    open,
    setOpen,
    note,
    range,
    busy,
    unresolved,
    reviewed,
    outcome,
    change,
    citations,
    assessments,
    annotations,
    possibleMatches,
    allAnnotations,
    saveAnnotation,
    refreshCreation,
    acknowledgeCreation,
    annotationWindow,
    assessmentWindow,
    loadMoreAnnotations: () => annotationWindow.more(annotations.data?.nextCursor),
    loadMoreAssessments: () => assessmentWindow.more(assessments.data?.nextCursor)
  };
}
