import type { ProjectId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { SelectedIcon, UnselectedIcon } from '@study/icons';
import { Loading } from '@study/ui/loading';
import { PageOverview } from '@study/ui/page-overview';
import { SearchField } from '@study/ui/search-field';
import { useState } from 'react';

import {
  useCursorRecovery,
  useCursorWindow,
  CursorWindowActions
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import type { SelectedNote } from '../note-workspace';

export function NotePicker({
  project,
  selected,
  onChange
}: {
  project?: ProjectId;
  selected: SelectedNote[];
  onChange: (notes: SelectedNote[]) => void;
}) {
  const { t } = useI18n();
  const window = useCursorWindow<NonNullable<Parameters<typeof rpc.notes.list.read>[0]['before']>>(
    String(project)
  );
  const state = rpc.notes.list.useQuery({ limit: window.limit, project, before: window.cursor });

  useCursorRecovery(window, state.error);
  const [query, setQuery] = useState('');
  const notes = (state.isError ? [] : (state.data?.items ?? [])).filter(
    (note) =>
      (!project || note.projectIds.includes(project)) &&
      (note.title || t('NoteUntitled')).toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );

  return (
    <PageOverview.Picker>
      <SearchField
        aria-label={t('PagesFindNotes')}
        placeholder={t('PagesFindNotes')}
        value={query}
        onValueChange={setQuery}
      />
      {state.isPending && <Loading label={t('LoadingStudy')} />}
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <PageOverview.NoteChoices>
        {notes.map((note) => {
          const checked = selected.some((item) => item.id === note.id);

          return (
            <li key={String(note.id)}>
              <PageOverview.NoteChoice
                variant="ghost"
                aria-pressed={checked}
                onClick={() =>
                  onChange(
                    checked
                      ? selected.filter((item) => item.id !== note.id)
                      : [...selected, { id: note.id, title: note.title }]
                  )
                }
              >
                {checked ? (
                  <SelectedIcon aria-hidden="true" />
                ) : (
                  <UnselectedIcon aria-hidden="true" />
                )}
                <span>{note.title || t('NoteUntitled')}</span>
              </PageOverview.NoteChoice>
            </li>
          );
        })}
      </PageOverview.NoteChoices>
      <CursorWindowActions
        {...window}
        hasMore={!!state.data?.next}
        pending={state.isFetching}
        more={() => window.more(state.data?.next)}
      />
      {state.isSuccess && !notes.length && <p>{t('PagesNoNotes')}</p>}
    </PageOverview.Picker>
  );
}
