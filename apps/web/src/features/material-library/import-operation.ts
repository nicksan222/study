import type { Source } from '@study/contracts/sources/schemas';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';

import { toStudyError } from '#web/lib/study-client/errors.ts';

import {
  importMutationKey as mutationKey,
  importMutationOptions
} from './material-library.queries';
import type { ImportInput } from './material-library.queries';

// The query cache owns observation beyond dialog and route lifetimes. No automatic mutation retries.
export function useImportOperation() {
  const client = useQueryClient();
  const mutation = useMutation(importMutationOptions());
  const states = useMutationState({
    filters: { mutationKey, exact: true },
    select: (entry) => ({
      status: entry.state.status,
      source: entry.state.data as Source | undefined,
      error: entry.state.error ? toStudyError(entry.state.error) : undefined
    })
  });
  const state = states.at(-1);
  const rejected = state?.status === 'error' && state.error?.kind === 'invalid_input';
  const busy = state?.status === 'pending';
  const ambiguous = state?.status === 'error' && !rejected;

  function acknowledge() {
    for (const entry of client.getMutationCache().findAll({ mutationKey, exact: true })) {
      if (entry.state.status !== 'pending') client.getMutationCache().remove(entry);
    }
  }

  function start(input: ImportInput) {
    const existing = client.getMutationCache().findAll({ mutationKey, exact: true }).at(-1);

    if (
      existing &&
      (existing.state.status === 'pending' ||
        existing.state.status === 'success' ||
        (existing.state.status === 'error' &&
          toStudyError(existing.state.error).kind !== 'invalid_input'))
    )
      return;

    acknowledge();
    mutation.mutate(input);
  }

  return {
    busy,
    ambiguous,
    rejected,
    source: state?.source,
    start,
    acknowledge
  };
}
