import type { Source } from '@study/contracts/sources/schemas';
import { Loading } from '@study/ui/loading';
import { MaterialLibrary } from '@study/ui/material-library';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation/read-error';

export function SourceLibrary({
  state,
  rememberRow
}: {
  state: UseQueryResult<Source[]>;
  rememberRow: (row: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t('AnswerSources')}>
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <MaterialLibrary.Rows>
        {!state.error &&
          state.data?.map((source) => (
            <li key={String(source.id)}>
              <Link
                id={`source-${source.id}`}
                to="/sources/$sourceId"
                params={{ sourceId: String(source.id) }}
                onClick={() => rememberRow(`source-${source.id}`)}
              >
                <MaterialLibrary.RowTitle>{source.name}</MaterialLibrary.RowTitle>
                <MaterialLibrary.RowMeta>{source.mime}</MaterialLibrary.RowMeta>
              </Link>
            </li>
          ))}
      </MaterialLibrary.Rows>
    </section>
  );
}
