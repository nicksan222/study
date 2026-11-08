import type { ProjectId } from '@study/contracts/ids';
import { Loading } from '@study/ui/loading';
import { PageOverview } from '@study/ui/page-overview';
import { SearchField } from '@study/ui/search-field';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { notesQueryOptions } from '#web/lib/study-client/study.queries.ts';

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
  const state = useQuery(notesQueryOptions());
  const [query, setQuery] = useState('');
  const notes = (state.isError ? [] : (state.data ?? [])).filter(
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
                {checked ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                <span>{note.title || t('NoteUntitled')}</span>
              </PageOverview.NoteChoice>
            </li>
          );
        })}
      </PageOverview.NoteChoices>
      {state.isSuccess && !notes.length && <p>{t('PagesNoNotes')}</p>}
    </PageOverview.Picker>
  );
}
