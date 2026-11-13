import type { PageAnnotationId } from '@study/contracts/ids';
import type {
  annotationSchema,
  annotationOutcomeSchema,
  createAnnotationSchema
} from '@study/contracts/pages/evidence';
import type { rangeSchema } from '@study/contracts/pages/evidence';
import type { PageVersion } from '@study/contracts/pages/types';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { request } from '#client/lib/study-client/request.ts';

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
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  type Creation = {
    note: string;
    range?: typeof rangeSchema.Type;
    generation: number;
    busy: boolean;
    unresolved?: typeof createAnnotationSchema.Type;
    reviewed: boolean;
    outcome?: typeof annotationOutcomeSchema.Type;
  };

  const creationKey = ['annotationCreation', String(version.id)];
  const creation = useQuery<Creation>({
    queryKey: creationKey,
    initialData: { note: '', generation: 0, busy: false, reviewed: false },
    queryFn: () => ({ note: '', generation: 0, busy: false, reviewed: false }),
    staleTime: Infinity,
    gcTime: Infinity
  });
  const { note, range, busy, unresolved, reviewed, outcome } = creation.data;

  function change(next: Partial<Creation>) {
    client.setQueryData<Creation>(
      creationKey,
      (old) => old && { ...old, ...next, generation: old.generation + 1 }
    );
  }

  const retained = useQuery<readonly (typeof annotationSchema.Type)[]>({
    queryKey: ['annotationRetained', String(version.pageId)],
    initialData: [],
    queryFn: () => [],
    staleTime: Infinity,
    gcTime: Infinity
  });
  const citations = useQuery({
    queryKey: ['pages', 'evidence', String(version.id)],
    enabled: open,
    queryFn: ({ signal }) => request((rpc) => rpc['pages.version']({ id: version.id }), signal)
  });
  const assessments = useInfiniteQuery({
    queryKey: ['pages', 'assessments', String(version.id)],
    enabled: open,
    initialPageParam: undefined as bigint | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) => rpc['pages.assessments']({ versionId: version.id, limit: 30, cursor: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const annotations = useInfiniteQuery({
    queryKey: ['pages', 'annotations', String(version.pageId)],
    enabled: open,
    initialPageParam: undefined as PageAnnotationId | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['pages.annotations']({
          pageId: version.pageId,
          limit: 30,
          cursor: pageParam,
          includeDeleted: true
        })
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

  useEffect(() => {
    if (!annotations.data) return;

    client.setQueryData<readonly (typeof annotationSchema.Type)[]>(
      ['annotationRetained', String(version.pageId)],
      (old) =>
        retainAnnotations(
          old ?? [],
          annotations.data.pages.flatMap((page) => page.items)
        )
    );
  }, [annotations.data, client, version.pageId]);
  const possibleMatches = unresolved
    ? retained.data.filter((item) => matchesCreation(item, unresolved))
    : [];

  async function saveAnnotation() {
    const submitted = client.getQueryData<Creation>(creationKey);

    if (!submitted?.range || submitted.busy || submitted.unresolved) return;

    const input = {
      target: { pageId: version.pageId, range: submitted.range },
      kind: submitted.note.trim() ? ('note' as const) : ('highlight' as const),
      note: submitted.note
    };

    client.setQueryData(creationKey, {
      ...submitted,
      busy: true,
      reviewed: false,
      outcome: undefined
    });

    try {
      const result = await request((rpc) => rpc['pages.createAnnotation'](input));

      client.setQueryData<Creation>(
        creationKey,
        (old) =>
          old && {
            ...old,
            outcome: result,
            ...(result.outcome === 'saved' && old.generation === submitted.generation
              ? { range: undefined, note: '' }
              : {})
          }
      );

      if (result.outcome === 'saved') {
        client.setQueryData<readonly (typeof annotationSchema.Type)[]>(
          ['annotationRetained', String(version.pageId)],
          (old) => retainAnnotations(old ?? [], [result.annotation])
        );
        await client.invalidateQueries({ queryKey: ['pages', 'annotations'] });
      }
    } catch {
      client.setQueryData<Creation>(
        creationKey,
        (old) => old && { ...old, unresolved: input, reviewed: false }
      );
    } finally {
      client.setQueryData<Creation>(creationKey, (old) => old && { ...old, busy: false });
    }
  }

  async function refreshCreation() {
    const result = await annotations.refetch();

    client.setQueryData<Creation>(
      creationKey,
      (old) => old && { ...old, reviewed: !result.isError && !old.busy }
    );
  }

  function acknowledgeCreation() {
    client.setQueryData<Creation>(creationKey, (old) =>
      old && !old.busy && old.reviewed ? { ...old, unresolved: undefined, reviewed: false } : old
    );
  }

  const visible = annotations.data?.pages.flatMap((page) => page.items) ?? [];
  const visibleIds = new Set(visible.map((item) => item.id));
  const allAnnotations = [...visible, ...retained.data.filter((item) => !visibleIds.has(item.id))];

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
    acknowledgeCreation
  };
}
