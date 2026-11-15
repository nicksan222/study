import type { PageId, PageVersionId } from '@study/contracts/ids';
import type { annotationTargetSchema } from '@study/contracts/pages/evidence';
import { rpc } from '@study/contracts/react';
import { validBlockTextRange } from '@study/contracts/sources/document';

type Target = typeof annotationTargetSchema.Type;

export function useAnnotationPage(pageId: PageId, version: PageVersionId) {
  const state = rpc.pages.version.useQuery({ id: version });
  const exact = state.data;

  return {
    ...state,
    data:
      exact === undefined
        ? undefined
        : exact.pageId === pageId && exact.status === 'published'
          ? exact
          : null
  };
}

export function useRetainedRange(target: Target, enabled = true) {
  const state = rpc.pages.version.useQuery({ id: target.range.versionId }, { enabled });
  const exact = state.data;
  const valid =
    exact &&
    exact.pageId === target.pageId &&
    exact.status === 'published' &&
    exact.snapshotId === target.range.snapshotId &&
    validBlockTextRange(exact.document, target.range);

  return {
    ...state,
    data:
      exact === undefined
        ? undefined
        : valid
          ? (exact.document.blocks.find((block) => block.id === target.range.blockId)?.text ?? null)
          : null
  };
}
