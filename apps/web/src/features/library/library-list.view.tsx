import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Sidebar } from '@study/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { Layers, GraduationCap } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';
import type { AppSearch } from '#web/lib/navigation/route-contract.ts';
import type { Subjects } from '#web/lib/study-client/operations.ts';

import { itemLocation } from './library.locations';
import type { LibraryItem } from './library.logic';

export function LibraryListView({
  state,
  subjects,
  blocked,
  query,
  search,
  reload
}: {
  state:
    | { status: 'pending' }
    | { status: 'error'; error?: unknown }
    | { status: 'success'; data: LibraryItem[] };
  subjects: Subjects;
  blocked: boolean;
  query: string;
  search: AppSearch;
  reload: () => void;
}) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();

  if (blocked) return null;

  if (state.status === 'error')
    return (
      <ErrorState
        layout="sidebar"
        title={t('ErrorStateTitle')}
        action={
          <Button variant="ghost-muted" onClick={reload}>
            {t('StudyLoadError')}
          </Button>
        }
      />
    );

  if (state.status === 'pending') return <Loading layout="sidebar" label={t('LoadingStudy')} />;

  const items = state.data.filter((item) =>
    item.value.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  return (
    <Sidebar.Items aria-label={t('Practice')}>
      {items.map((item) => {
        const kind = item.value.kind;
        const { Icon, labelKey } = libraryItemPresentation(kind);
        const label = t(labelKey);
        const title = item.value.title;
        const projectId = itemProjectId(item);
        const updated = itemTimestamp(item);
        const owner = subjects.find((subject) => subject.id === projectId);
        const active = search.material === String(item.value.id);

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
            render={<Link {...itemLocation(item, search.project)} />}
          />
        );
      })}
      {items.length === 0 && (
        <Sidebar.Message>
          {t(query.trim() ? 'SearchNoResults' : 'SidebarPracticeEmpty')}
        </Sidebar.Message>
      )}
    </Sidebar.Items>
  );
}

function libraryItemPresentation(kind: string) {
  switch (kind) {
    case 'flashcards':
      return { Icon: Layers, labelKey: 'Flashcards' as const };
    default:
      return { Icon: GraduationCap, labelKey: 'SidebarQuiz' as const };
  }
}

function itemProjectId(item: LibraryItem) {
  return item.value.projectIds.length === 1 ? item.value.projectIds[0] : undefined;
}

function itemTimestamp(item: LibraryItem) {
  return item.value.updated_at;
}
