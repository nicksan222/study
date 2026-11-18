import { RegistryContext, useAtom, useAtomInitialValues } from '@effect/atom-react';
import { rpc } from '@study/contracts/react';
import { toastManager } from '@study/ui';
import { useContext, useEffect, useState } from 'react';

import { useDictationSubmission } from '#client/features/voice/index.ts';
import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { annotationDrafts, annotationCandidates } from './annotation-drafts';
import {
  annotationBlocked,
  annotationRevisionInput,
  acknowledgedAnnotationDraft,
  retainAnnotations
} from './annotation-state';
import type { Annotation, AnnotationDraft } from './annotation-state';

/** Each draft keeps submitted generations distinct from later edits and live remote revisions. */
export function useAnnotationControls({ annotation }: { annotation: Annotation }) {
  const { t } = useI18n();
  const submission = useDictationSubmission();
  const registry = useContext(RegistryContext);
  const atom = annotationDrafts(annotation.id);
  const initial: AnnotationDraft = {
    note: annotation.note,
    kind: annotation.kind,
    current: annotation,
    generation: 0,
    pending: false,
    uncertain: false
  };

  useAtomInitialValues([[atom, initial]]);
  const [value, setDraft] = useAtom(atom);
  const draft = value ?? initial;
  const [, setRetained] = useAtom(annotationCandidates(annotation.target.pageId));
  const { result, error } = draft;
  const [deleting, setDeleting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reanchor, setReanchor] = useState(false);
  const latest = rpc.pages.annotation.useQuery({ id: annotation.id });

  function updateDraft(change: (old: AnnotationDraft) => AnnotationDraft) {
    setDraft((old) => change(old ?? initial));
  }

  useEffect(() => {
    const stored = latest.data;

    if (!stored) return;

    setRetained((old) => retainAnnotations(old, [stored]));
    setDraft((old) =>
      old &&
      !old.pending &&
      stored.revision > old.current.revision &&
      (!old.review || stored.revision > old.review.revision)
        ? { ...old, review: stored }
        : old
    );
  }, [latest.data, setRetained, setDraft]);
  const historyWindow = useCursorWindow<bigint>(String(annotation.id));
  const historyLimit = historyWindow.limit;
  const history = rpc.pages.annotationHistory.useQuery(
    { id: annotation.id, limit: historyLimit, cursor: historyWindow.cursor },
    { enabled: historyOpen }
  );

  useCursorRecovery(historyWindow, history.error);

  function edit(next: Partial<AnnotationDraft>) {
    updateDraft((old) => ({ ...old, ...next, generation: old.generation + 1 }));
  }

  async function mutate(operation: 'update' | 'reanchor' | 'delete') {
    if (operation === 'update' && submission.isBlocked()) return;

    const submitted = registry.get(atom) ?? initial;

    const input = annotationRevisionInput(annotation.id, submitted, operation);

    if (!input) return;

    setDraft({ ...submitted, pending: true, error: undefined });

    try {
      const outcome = await rpc.pages.reviseAnnotation.call(input);

      if (outcome.outcome === 'saved')
        setRetained((old) => retainAnnotations(old, [outcome.annotation]));

      updateDraft((old) =>
        acknowledgedAnnotationDraft(
          old,
          outcome,
          operation === 'update' ? submitted.generation : -1
        )
      );

      if (operation === 'delete' && outcome.outcome === 'saved') {
        toastManager.add({ title: t('AnnotationDeleted'), type: 'success' });
        setDeleting(false);
      }
    } catch (cause) {
      updateDraft((old) => ({
        ...old,
        pending: false,
        uncertain: true,
        error: toStudyError(cause).kind
      }));
    }
  }

  async function reviewLatest() {
    try {
      const stored = await rpc.pages.annotation.read({ id: annotation.id });

      updateDraft((old) =>
        !old.pending &&
        stored.revision >= old.current.revision &&
        (!old.review || stored.revision >= old.review.revision)
          ? { ...old, review: stored }
          : old
      );
      latest.retry();
    } catch (cause) {
      updateDraft((old) => ({ ...old, error: toStudyError(cause).kind }));
    }
  }

  return {
    t,
    annotation,
    key: String(annotation.id),
    draft,
    result,
    error,
    deleting,
    setDeleting,
    historyOpen,
    setHistoryOpen,
    reanchor,
    setReanchor,
    latest,
    history,
    edit,
    mutate,
    submission,
    blocked: annotationBlocked(draft),
    updateDraft,
    reviewLatest,
    historyWindow,
    loadMoreHistory: () => historyWindow.more(history.data?.nextCursor)
  };
}
