import type { ProjectId } from '@study/contracts/ids';
import { noteIdSchema, pageIdSchema, materialIdSchema } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { useMatches, useParams, useSearch } from '@tanstack/react-router';

import type { PageMetadata } from '#client/lib/navigation/route-contract.ts';

/** Resolves route-owned subject membership without knowing any feature's entity types. */
export function useSidebarContext(metadata: PageMetadata) {
  const search = useSearch({ from: '__root__' });
  const params = useParams({ strict: false });
  const matched = useMatches({ select: (matches) => matches.at(-1)?.status === 'success' });
  const resolve = metadata.sidebar?.owner;
  const identity = matched ? resolve?.(params) : undefined;
  const owner = useOwner(identity);
  const ready = !resolve || (matched && owner.isSuccess);
  const requestedProject = resolve
    ? ownerProject(owner.data?.projectIds, search.project)
    : (search.project ?? null);

  return {
    requestedProject,
    ready,
    status: ownerStatus(matched, owner),
    owned: resolve !== undefined,
    reload: () => {
      if (identity) owner.refetch();
    }
  };
}

function ownerProject(ids: readonly ProjectId[] | undefined, preferred?: string) {
  if (!ids?.length) return null;

  return String(ids.find((id) => String(id) === preferred) ?? ids[0]);
}

function ownerStatus(matched: boolean, owner: { isPending: boolean; isError: boolean }) {
  if (!matched || owner.isPending) return 'pending' as const;

  return owner.isError ? ('error' as const) : ('success' as const);
}

function useOwner(identity: { kind: 'note' | 'page' | 'material'; id: bigint } | undefined) {
  const id = identity?.id ?? 1n;
  const kind = identity?.kind;
  const note = rpc.notes.get.useQuery({ id: noteIdSchema.make(id) }, { enabled: kind === 'note' });
  const page = rpc.pages.get.useQuery({ id: pageIdSchema.make(id) }, { enabled: kind === 'page' });
  const material = rpc.materials.get.useQuery(
    { id: materialIdSchema.make(id) },
    { enabled: kind === 'material' }
  );

  switch (kind) {
    case 'note':
      return note;
    case 'page':
      return page;
    default:
      return material;
  }
}
