import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch, useNavigate, useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState, useCallback } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { projectsQueryOptions } from '../../lib/study-client/study.queries';
import { importReturn, libraryReturn, libraryEntries } from './browse-state';
import type { BrowseSnapshot } from './browse-state';
import { collectionId } from './identity';
import { useImportOperation } from './import-operation';
import { materialPage, materialsOptions } from './material-library.queries';

export function useLibraryPage() {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const projectId = collectionId(search.project);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const state = useInfiniteQuery(materialsOptions(projectId));
  const collections = useQuery(projectsQueryOptions());
  const [open, setOpen] = useState(false);
  const importRef = useRef<HTMLButtonElement>(null);
  const operation = useImportOperation();
  const accepted = operation.source;
  const entryKey = useLocation({
    select: (location) => location.state.__TSR_key
  });
  const {
    nextGeneration,
    isCurrentGeneration,
    invalidateReveal,
    refreshError,
    refreshing,
    setRefreshError,
    setRefreshing
  } = useRevealState(search.project);
  const [previous, setPrevious] = useState<BrowseSnapshot | null>(importReturn.previous);
  const items = state.data?.pages.flatMap((page) => page.items) ?? [];
  const acceptedLookup = useQuery({
    queryKey: ['materials', 'imported', String(accepted?.id)],
    enabled: !!accepted,
    queryFn: () => request((rpc) => rpc['materials.importedMaterial']({ sourceId: accepted!.id }))
  });
  const match = acceptedLookup.data;

  useBrowseRestoration(state.data, entryKey);

  function rememberRow(row: string) {
    libraryReturn.row = row;
    libraryReturn.scroll =
      document.querySelector<HTMLElement>('[data-library-scroll], main.study-content')?.scrollTop ??
      0;
    libraryReturn.fromReader = true;

    if (entryKey) libraryEntries.set(entryKey, { row, scroll: libraryReturn.scroll });
  }

  function rememberBrowse() {
    const snapshot = {
      project: search.project,
      data: state.data,
      scroll:
        document.querySelector<HTMLElement>('[data-library-scroll], main.study-content')
          ?.scrollTop ?? 0
    };

    importReturn.previous = snapshot;
    setPrevious(snapshot);
  }

  async function reveal() {
    const generation = nextGeneration();

    setRefreshing(true);
    setRefreshError(false);
    await revealLibrary({
      queryClient,
      navigate,
      setRefreshing,
      setRefreshError,
      isCurrent: () => isCurrentGeneration(generation)
    });
  }

  function restorePrevious() {
    invalidateReveal();
    setRefreshing(false);
    restoreLibraryBrowse(previous, { queryClient, navigate, acknowledge: operation.acknowledge });
    setPrevious(null);
  }

  return {
    t,
    search,
    queryClient,
    navigate,
    state,
    collections,
    open,
    setOpen,
    importRef,
    operation,
    accepted,
    refreshError,
    refreshing,
    previous,
    items,
    acceptedLookup,
    match,
    rememberRow,
    rememberBrowse,
    reveal,
    restorePrevious
  };
}

function useBrowseRestoration(data: unknown, entryKey: string | undefined) {
  const restoredEntry = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!data) return;

    const saved = entryKey ? libraryEntries.get(entryKey) : undefined;

    if (!libraryReturn.fromReader && (!saved || restoredEntry.current === entryKey)) return;

    const position = saved ?? libraryReturn;

    libraryReturn.fromReader = false;
    restoredEntry.current = entryKey;
    const main = document.querySelector<HTMLElement>('[data-library-scroll], main.study-content');
    const row = document.getElementById(position.row);

    (row ?? document.getElementById('library-heading'))?.focus({
      preventScroll: true
    });

    if (main) main.scrollTop = position.scroll;
  }, [data, entryKey]);
}

async function revealLibrary({
  queryClient,
  navigate,
  setRefreshing,
  setRefreshError,
  isCurrent
}: {
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setRefreshing: (value: boolean) => void;
  setRefreshError: (value: boolean) => void;
  isCurrent: () => boolean;
}) {
  try {
    await queryClient.cancelQueries({
      queryKey: materialsOptions().queryKey,
      exact: true
    });

    if (!isCurrent()) return;

    const page = await materialPage();

    if (!isCurrent()) return;

    queryClient.setQueryData(materialsOptions().queryKey, {
      pages: [page],
      pageParams: [undefined]
    });
    await navigate({ to: '/library', search: {}, replace: true });
  } catch {
    if (isCurrent()) setRefreshError(true);
  } finally {
    if (isCurrent()) setRefreshing(false);
  }
}

function restoreLibraryBrowse(
  previous: BrowseSnapshot | null,
  {
    queryClient,
    navigate,
    acknowledge
  }: {
    queryClient: ReturnType<typeof useQueryClient>;
    navigate: ReturnType<typeof useNavigate>;
    acknowledge: () => void;
  }
) {
  if (!previous) return;

  if (previous.data)
    queryClient.setQueryData(
      materialsOptions(collectionId(previous.project)).queryKey,
      previous.data
    );

  void navigate({
    to: '/library',
    search: previous.project ? { project: previous.project } : {}
  }).then(() => {
    const main = document.querySelector<HTMLElement>('[data-library-scroll], main.study-content');

    if (main) main.scrollTop = previous.scroll;

    document.getElementById('library-heading')?.focus({ preventScroll: true });
  });
  libraryReturn.scroll = previous.scroll;
  libraryReturn.fromReader = true;
  acknowledge();
  importReturn.previous = null;
}

function useRevealState(project: string | undefined) {
  const router = useRouter();
  const revealGeneration = useRef(0);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(
    () =>
      router.subscribe('onBeforeNavigate', () => {
        // A destination loader may keep this view mounted while navigation is already in flight.
        revealGeneration.current++;
        setRefreshing(false);
      }),
    [router]
  );
  const invalidateReveal = useCallback(() => {
    revealGeneration.current++;
  }, []);

  useEffect(() => invalidateReveal, [project, invalidateReveal]);

  return {
    nextGeneration: () => ++revealGeneration.current,
    isCurrentGeneration: (generation: number) => generation === revealGeneration.current,
    invalidateReveal,
    refreshError,
    refreshing,
    setRefreshError,
    setRefreshing
  };
}
