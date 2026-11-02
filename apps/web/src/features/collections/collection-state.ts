import type { ErrorKind } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { toStudyError } from '../../lib/study-client/errors';

type NameDraft = { text: string; revision: number };
type CollectionState = {
  name: NameDraft;
  names: Record<string, NameDraft>;
  selected: ProjectId | null;
  accepted: ProjectId | null;
  uncertain: boolean;
  pending: boolean;
  reviewed: boolean;
  error?: ErrorKind;
};
const key = ['collection-drafts'] as const;
const initial: CollectionState = {
  name: { text: '', revision: 0 },
  names: {},
  selected: null,
  accepted: null,
  uncertain: false,
  pending: false,
  reviewed: false
};

export function validCollectionName(name: string) {
  return name.trim().length > 0 && [...name.trim()].length <= 100;
}

export function useCollectionState() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    gcTime: Infinity,
    staleTime: Infinity
  });
  function update(change: (state: CollectionState) => CollectionState) {
    client.setQueryData<CollectionState>(key, (value) => change(value ?? initial));
  }
  async function mutate(action: () => Promise<unknown>) {
    if (client.getQueryData<CollectionState>(key)?.pending) return;
    update((value) => ({ ...value, pending: true, error: undefined, reviewed: false }));
    try {
      await action();
    } catch (error) {
      update((value) => ({ ...value, error: toStudyError(error).kind }));
    } finally {
      // A lost response may follow a committed write. Reconcile reads without replaying it.
      await Promise.allSettled(
        ['projects', 'materials', 'sessions', 'session-workspace', 'search'].map((prefix) =>
          client.invalidateQueries({ queryKey: [prefix] })
        )
      );
      update((value) => ({ ...value, pending: false }));
    }
  }
  return { state: query.data, update, mutate };
}
