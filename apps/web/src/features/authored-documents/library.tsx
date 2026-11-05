import type { ProjectId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import type { useLibraryPage } from '../material-library';

type State = ReturnType<typeof useLibraryPage>['documents'];

export function AuthoredLibrary({
  state,
  rememberRow,
  project
}: {
  state: State;
  rememberRow?: (row: string) => void;
  project?: ProjectId;
}) {
  const { t } = useI18n();
  const items = state.isError ? [] : (state.data?.pages.flatMap((page) => page.items) ?? []);

  return (
    <section aria-label={t('SourceDocument')}>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <MaterialLibrary.Rows>
        {items.map((item) => (
          <li key={String(item.id)}>
            <Link
              id={`document-${item.id}`}
              to="/documents/$documentId"
              params={{ documentId: String(item.id) }}
              search={project ? { project: String(project) } : {}}
              onClick={() => rememberRow?.(`document-${item.id}`)}
            >
              <MaterialLibrary.RowTitle>{item.title}</MaterialLibrary.RowTitle>
              <MaterialLibrary.RowMeta>
                {item.description ?? t('SourceDocument')}
              </MaterialLibrary.RowMeta>
            </Link>
          </li>
        ))}
      </MaterialLibrary.Rows>
      {state.hasNextPage && (
        <Button disabled={state.isFetchingNextPage} onClick={() => void state.fetchNextPage()}>
          {t('LibraryMore')}
        </Button>
      )}
    </section>
  );
}
