import type { ProjectId } from '@study/contracts/ids';
import { DocumentOverview } from '@study/ui/document-overview';
import { Loading } from '@study/ui/loading';
import { SearchField } from '@study/ui/search-field';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { sessionsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import { ContentReadError } from '../document-presentation';
import type { SelectedSession } from '../session-workspace';

export function SessionPicker({
  project,
  selected,
  onChange
}: {
  project?: ProjectId;
  selected: SelectedSession[];
  onChange: (sessions: SelectedSession[]) => void;
}) {
  const { t } = useI18n();
  const state = useQuery(sessionsQueryOptions());
  const [query, setQuery] = useState('');
  const sessions = (state.isError ? [] : (state.data ?? [])).filter(
    (session) =>
      (!project || session.projectIds.includes(project)) &&
      (session.title || t('SessionUntitled'))
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
  );

  return (
    <DocumentOverview.Picker>
      <SearchField
        aria-label={t('DocumentsFindSessions')}
        placeholder={t('DocumentsFindSessions')}
        value={query}
        onValueChange={setQuery}
      />
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <DocumentOverview.SessionChoices>
        {sessions.map((session) => {
          const checked = selected.some((item) => item.id === session.id);

          return (
            <li key={String(session.id)}>
              <DocumentOverview.SessionChoice
                variant="ghost"
                aria-pressed={checked}
                onClick={() =>
                  onChange(
                    checked
                      ? selected.filter((item) => item.id !== session.id)
                      : [...selected, { id: session.id, title: session.title }]
                  )
                }
              >
                {checked ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                <span>{session.title || t('SessionUntitled')}</span>
              </DocumentOverview.SessionChoice>
            </li>
          );
        })}
      </DocumentOverview.SessionChoices>
      {state.isSuccess && !sessions.length && <p>{t('DocumentsNoSessions')}</p>}
    </DocumentOverview.Picker>
  );
}
