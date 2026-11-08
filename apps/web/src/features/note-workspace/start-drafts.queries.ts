import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

/** Starter drafts belong to the query cache for this app lifetime, never the database. */
export const startDraftKey = (project?: string) => ['note-start-draft', project ?? 'unassigned'];

export const startDraftsOptions = () =>
  queryOptions({
    queryKey: ['note-start-drafts'],
    queryFn: (): string[] => [],
    initialData: [] as string[],
    gcTime: Infinity,
    staleTime: Infinity
  });

export function openStartDraft(cache: QueryClient, project?: string) {
  cache.setQueryDefaults(['note-start-draft'], { gcTime: Infinity, staleTime: Infinity });
  cache.setQueryDefaults(startDraftsOptions().queryKey, { gcTime: Infinity, staleTime: Infinity });
  const scope = project ?? 'unassigned';

  cache.setQueryData<string[]>(startDraftsOptions().queryKey, (scopes) =>
    scopes?.includes(scope) ? scopes : [scope, ...(scopes ?? [])]
  );
}

export function dismissStartDraft(cache: QueryClient, project?: string) {
  const key = startDraftKey(project);

  cache.setQueryData(key, '');
  cache.setQueryData([...key, 'files'], []);
  cache.setQueryData<string[]>(startDraftsOptions().queryKey, (scopes) =>
    (scopes ?? []).filter((scope) => scope !== key[1])
  );
}

/** A receipt consumes its snapshot while later edits remain available as a draft. */
export function finishStartDraft(
  cache: QueryClient,
  input: { draftKey: string[]; filesKey: string[]; text: string; files: File[] }
) {
  cache.setQueryData<File[]>(input.filesKey, (current) => {
    const submitted = [...input.files];

    return (current ?? []).filter((file) => {
      const index = submitted.indexOf(file);

      if (index < 0) return true;

      submitted.splice(index, 1);

      return false;
    });
  });
  cache.setQueryData<string>(input.draftKey, (current) => (current === input.text ? '' : current));
  const text = cache.getQueryData<string>(input.draftKey) ?? '';
  const files = cache.getQueryData<File[]>(input.filesKey) ?? [];

  if (!text.trim() && !files.length)
    cache.setQueryData<string[]>(startDraftsOptions().queryKey, (scopes) =>
      (scopes ?? []).filter((scope) => scope !== input.draftKey[1])
    );
}
