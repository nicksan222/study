import type { ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useEffect, useRef, useState } from 'react';

import type { Section } from '#client/lib/navigation/route-contract.ts';

export function useSidebarSearch({
  query,
  global,
  project,
  canSearch,
  section
}: {
  query: string;
  global: boolean;
  project: ProjectId | undefined;
  canSearch: boolean;
  section: Section;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);

    return () => clearTimeout(timer);
  }, [query]);
  const searchEnabled =
    Boolean(query.trim()) && query.trim() === debouncedQuery && canSearch && section === 'notes';
  const searchResult = rpc.system.search.useQuery(
    {
      query: query.trim(),
      project: global ? undefined : project,
      limit: 30,
      ...(global ? {} : { kinds: ['note', 'message'] })
    },
    { enabled: searchEnabled }
  );
  const result = searchResultState(searchEnabled, searchResult);
  const hits = result?.result?.hits ?? [];

  return { result, hits };
}

export function useSidebarSearchInput(collapsed: boolean, onToggle: () => void, visible: boolean) {
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = () => {
    if (collapsed) onToggle();

    requestAnimationFrame(() => searchRef.current?.focus());
  };

  useEffect(() => {
    if (!visible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();

        if (collapsed) onToggle();

        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsed, onToggle, visible]);

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
