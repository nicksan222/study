import type { MaterialAnnotationId } from '@study/contracts/ids';
import type {
  annotationSchema,
  annotationOutcomeSchema,
  createAnnotationSchema
} from '@study/contracts/materials/evidence';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import type { documentTextRangeSchema } from '@study/contracts/sources/schemas';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

import { retainAnnotations } from './annotation-state';

function matchesCreation(
  item: typeof annotationSchema.Type,
  unresolved: typeof createAnnotationSchema.Type
) {
  return (
    !item.deleted &&
    item.note === unresolved.note &&
    item.kind === unresolved.kind &&
    item.target.materialId === unresolved.target.materialId &&
    sameRange(item.target.range, unresolved.target.range)
  );
}

function sameRange(
  left: typeof documentTextRangeSchema.Type,
  right: typeof documentTextRangeSchema.Type
) {
  return (
    left.versionId === right.versionId &&
    left.documentId === right.documentId &&
    left.blockId === right.blockId &&
    left.start === right.start &&
    left.end === right.end
  );
}

export function useReaderEvidence(version: MaterialVersionDetailDto) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  type Creation = {
    note: string;
    range?: typeof documentTextRangeSchema.Type;
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
    queryKey: ['annotationRetained', String(version.material_id)],
    initialData: [],
    queryFn: () => [],
    staleTime: Infinity,
    gcTime: Infinity
  });
  const identity = useQuery({
    queryKey: ['materials', 'document', String(version.id)],
    enabled: open,
    queryFn: () => request((rpc) => rpc['materials.materialVersionDocument']({ id: version.id }))
  });

  const citations = useInfiniteQuery({
    queryKey: ['materials', 'citations', String(version.id)],
    enabled: open,
    initialPageParam: undefined as bigint | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['materials.citations']({ id: version.id, limit: 30, cursor: pageParam })
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const annotations = useInfiniteQuery({
    queryKey: ['materials', 'annotations', String(version.material_id)],
    enabled: open,
    initialPageParam: undefined as MaterialAnnotationId | undefined,
    queryFn: ({ pageParam }) =>
      request((rpc) =>
        rpc['materials.annotations']({
          materialId: version.material_id,
          limit: 30,
          cursor: pageParam
        })
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

  useEffect(() => {
    if (!annotations.data) return;

    client.setQueryData<readonly (typeof annotationSchema.Type)[]>(
      ['annotationRetained', String(version.material_id)],
      (old) =>
        retainAnnotations(
          old ?? [],
          annotations.data.pages.flatMap((page) => page.items)
        )
    );
  }, [annotations.data, client, version.material_id]);
  const possibleMatches = unresolved
    ? retained.data.filter((item) => matchesCreation(item, unresolved))
    : [];

  async function saveAnnotation() {
    const submitted = client.getQueryData<Creation>(creationKey);

    if (!submitted?.range || submitted.busy || submitted.unresolved) return;

    const input = {
      target: { materialId: version.material_id, range: submitted.range },
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
      const result = await request((rpc) => rpc['materials.createAnnotation'](input));

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
          ['annotationRetained', String(version.material_id)],
          (old) => retainAnnotations(old ?? [], [result.annotation])
        );
        await client.invalidateQueries({ queryKey: ['materials', 'annotations'] });
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
    identity,
    citations,
    annotations,
    possibleMatches,
    allAnnotations,
    saveAnnotation,
    refreshCreation,
    acknowledgeCreation
  };
}
