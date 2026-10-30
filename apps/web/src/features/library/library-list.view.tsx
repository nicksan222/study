import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { Sidebar } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { FileText, Network, Layers, GraduationCap } from 'lucide-react';

import type { OperationState } from '../../lib/effect/use-operation';
import { useI18n } from '../../lib/i18n';
import type { AppSearch } from '../../lib/navigation/route-contract';
import type { Subjects } from '../../lib/study-client/operations';
import { itemLocation } from './library.locations';
import type { ItemFilter, LibraryItem } from './library.logic';

export function LibraryListView({
  state,
  section,
  subjects,
  blocked,
  query,
  filter,
  search,
  reload
}: {
  state: OperationState<LibraryItem[]>;
  section: 'library' | 'practice';
  subjects: Subjects;
  blocked: boolean;
  query: string;
  filter: ItemFilter;
  search: AppSearch;
  reload: () => void;
}) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();

  if (blocked) return null;

  if (state.status === 'error')
    return (
      <Button variant="ghost-muted" onClick={reload}>
        {t('StudyLoadError')}
      </Button>
    );

  if (state.status !== 'ready')
    return <Sidebar.Message role="status">{t('LoadingStudy')}</Sidebar.Message>;

  const items = state.value.filter(
    (item) =>
      (filter === 'all' || filter === (item.type === 'source' ? 'source' : item.value.kind)) &&
      (item.type === 'source' ? item.value.name : item.value.title)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  );

  return (
    <Sidebar.Items aria-label={t(section === 'library' ? 'SidebarLibrary' : 'Practice')}>
      {items.map((item) => {
        const kind = item.type === 'source' ? 'source' : item.value.kind;
        const Icon =
          kind === 'source'
            ? FileText
            : kind === 'diagram'
              ? Network
              : kind === 'flashcards'
                ? Layers
                : GraduationCap;
        const label = t(
          kind === 'source'
            ? 'SearchKindFile'
            : kind === 'diagram'
              ? 'Diagrams'
              : kind === 'flashcards'
                ? 'Flashcards'
                : 'SidebarQuiz'
        );
        const title = item.type === 'source' ? item.value.name : item.value.title;
        const projectId = item.type === 'source' ? item.value.projectId : item.value.project_id;
        const updated = item.type === 'source' ? item.value.createdAt : item.value.updated_at;
        const owner = subjects.find((subject) => subject.id === projectId);
        const active =
          item.type === 'source'
            ? search.id === String(item.value.id) && !search.material
            : search.material === String(item.value.id);

        return (
          <Sidebar.Item
            key={`${item.type}:${item.value.id}`}
            label={title}
            icon={<Icon aria-hidden="true" />}
            context={owner?.name ?? t('Projects')}
            description={label}
            timestamp={
              <time dateTime={new Date(Number(updated) * 1000).toISOString()} title={date(updated)}>
                {age(locale, now - Number(updated))}
              </time>
            }
            aria-label={title}
            aria-current={active ? 'page' : undefined}
            title={title}
            render={<Link {...itemLocation(item)} />}
          />
        );
      })}
      {items.length === 0 && (
        <Sidebar.Message>
          {t(
            query.trim() || filter !== 'all'
              ? 'SearchNoResults'
              : section === 'library'
                ? 'SidebarLibraryEmpty'
                : 'SidebarPracticeEmpty'
          )}
        </Sidebar.Message>
      )}
    </Sidebar.Items>
  );
}
