import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { librarySearches, libraryEntries, libraryReturn } from './browse-state';
import { materialSearchOptions } from './material-library.queries';

export function MaterialSearch({ rememberRow }: { rememberRow: (id: string) => void }) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const scope = search.project ?? '';
  const entryKey = useLocation({ select: (location) => location.state.__TSR_key });
  const [text, setText] = useState(() => librarySearches.get(scope)?.text ?? '');
  const [query, setQuery] = useState(() => librarySearches.get(scope)?.query ?? '');
  const restored = useRef(false);
  const state = useQuery(materialSearchOptions(query));

  useEffect(() => {
    if (!state.data || restored.current) return;

    const position = (entryKey ? libraryEntries.get(entryKey) : undefined) ?? libraryReturn;

    if (!position.row.startsWith('search-hit-')) return;

    const row = document.getElementById(position.row);

    if (!row) return;

    restored.current = true;
    row.focus({ preventScroll: true });
    const main = document.querySelector<HTMLElement>('[data-library-scroll], main.study-content');

    if (main) main.scrollTop = position.scroll;
  }, [state.data, entryKey]);

  return (
    <MaterialLibrary.Search>
      <MaterialLibrary.SearchForm
        onSubmit={(event) => {
          event.preventDefault();
          const next = text.trim();

          setQuery(next);
          librarySearches.set(scope, { text, query: next });
          restored.current = true;
        }}
      >
        <label>
          {t('LibraryGlobalSearch')}
          <Input
            value={text}
            onValueChange={(value) => {
              setText(value);
              librarySearches.set(scope, { text: value, query });
            }}
            maxLength={1000}
          />
        </label>
        <Button type="submit" disabled={!text.trim()}>
          {t('LibrarySearchAction')}
        </Button>
      </MaterialLibrary.SearchForm>
      {query && (
        <>
          <p>{t('LibrarySearchBounded')}</p>
          {state.isPending && <Loading label={t('LoadingStudy')} />}
          {state.isError && (
            <ErrorState
              title={t('ErrorStateTitle')}
              description={t('LibraryLoadFailed')}
              action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
            />
          )}
          <ul>
            {state.data?.hits.map((hit) => (
              <li key={String(hit.target.materialId)}>
                <Link
                  to="/materials/$materialId"
                  params={{ materialId: String(hit.target.materialId) }}
                  search={{ project: search.project, version: String(hit.target.versionId) }}
                  id={`search-hit-${hit.target.materialId}`}
                  onClick={() => rememberRow(`search-hit-${hit.target.materialId}`)}
                >
                  {hit.title}
                </Link>
                <p>{hit.excerpt}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </MaterialLibrary.Search>
  );
}
