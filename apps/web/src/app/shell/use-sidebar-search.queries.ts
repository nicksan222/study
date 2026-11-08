import type { ProjectId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { sidebarContent } from '#web/lib/navigation/sidebar-config.ts';
import { searchQueryOptions } from '#web/lib/study-client/study.queries.ts';

export function useSidebarSearch({
  query,
  global,
  project,
  canSearch,
  content
}: {
  query: string;
  global: boolean;
  project: ProjectId | undefined;
  canSearch: boolean;
  content: ReturnType<typeof sidebarContent>;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);

    return () => clearTimeout(timer);
  }, [query]);
  const searchEnabled =
    Boolean(query.trim()) &&
    query.trim() === debouncedQuery &&
    canSearch &&
    content === 'workspace';
  const searchResult = useQuery(
    searchQueryOptions(
      {
        query: query.trim(),
        project: global ? undefined : project,
        limit: 30,
        ...(global ? {} : { kinds: ['note', 'message'] })
      },
      searchEnabled
    )
  );
  const result = searchResultState(searchEnabled, searchResult);
  const hits = result?.result?.hits ?? [];

  return { result, hits };
}

export function useSidebarSearchInput(collapsed: boolean, onToggle: () => void) {
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = () => {
    if (collapsed) onToggle();

    requestAnimationFrame(() => searchRef.current?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();

        if (collapsed) onToggle();

        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsed, onToggle]);

  return { searchRef, openSearch };
}

function searchResultState<T>(
  enabled: boolean,
  state: { isSuccess: boolean; isError: boolean; data: T }
) {
  if (!enabled) return undefined;

  if (state.isSuccess) return { result: state.data!, error: false };

  if (state.isError) return { result: undefined, error: true };

  return undefined;
}
