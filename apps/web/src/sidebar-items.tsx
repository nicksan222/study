import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { Sidebar } from '@study/ui/sidebar';
import { Link, useLocation } from '@tanstack/react-router';
import { FileText, Network, Layers, GraduationCap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useI18n } from './i18n';
import { studyClient } from './study-client';

type Source = Awaited<ReturnType<typeof studyClient.sources.sources.query>>['items'][number];

type Material = Awaited<ReturnType<typeof studyClient.materials.list.query>>['items'][number];

type Subject = Awaited<ReturnType<typeof studyClient.projects.projects.query>>['items'][number];

export type SidebarItemFilter = 'all' | 'session' | 'source' | 'diagram' | 'flashcards' | 'quiz';

type Item = { type: 'source'; value: Source } | { type: 'material'; value: Material };

function itemLocation(item: Item) {
  if (item.type === 'source')
    return {
      to: '/MediaList',
      search: {
        id: String(item.value.id),
        ...(item.value.projectId ? { project: String(item.value.projectId) } : {})
      }
    } as const;

  return {
    to:
      item.value.kind === 'diagram'
        ? '/Diagrams'
        : item.value.kind === 'flashcards'
          ? '/Flashcards'
          : '/Practice',
    search: { project: String(item.value.project_id), material: String(item.value.id) }
  } as const;
}

export function SidebarItems({
  section,
  subjects,
  project,
  blocked,
  ready,
  query,
  filter
}: {
  section: 'library' | 'practice';
  subjects: readonly Subject[];
  project?: bigint;
  blocked: boolean;
  ready: boolean;
  query: string;
  filter: SidebarItemFilter;
}) {
  const { t, locale, date } = useI18n();
  const now = useNowMinute();
  const search = useLocation({ select: (location) => location.searchStr });
  const selected = new URLSearchParams(search);
  const [refresh, setRefresh] = useState(0);
  const projectIds = useMemo(
    () => (project ? [project] : subjects.map((subject) => subject.id)),
    [project, subjects]
  );
  const key = `${section}:${projectIds.map(String).join(',')}`;
  const [state, setState] = useState<{ key: string; items?: Item[]; error?: boolean }>();

  useEffect(() => {
    if (blocked || !ready) return;

    const controller = new AbortController();
    const load = async () => {
      const [sources, materials] = await Promise.all([
        section === 'library'
          ? studyClient.sources.sources.query({}, { signal: controller.signal })
          : Promise.resolve({ items: [] as Source[] }),
        Promise.all(
          projectIds.map(async (projectId) => {
            const items: Material[] = [];
            let cursor: bigint | undefined;

            do {
              const page = await studyClient.materials.list.query(
                { projectId, cursor, take: 100, archived: false },
                { signal: controller.signal }
              );

              items.push(...page.items);
              cursor = page.nextCursor ?? undefined;
            } while (cursor !== undefined && !controller.signal.aborted);

            return items;
          })
        )
      ]);
      const items: Item[] = [
        ...sources.items
          .filter((source) => !project || source.projectId === project)
          .map((value): Item => ({ type: 'source', value })),
        ...materials
          .flat()
          .filter((material) =>
            section === 'library'
              ? material.kind === 'diagram'
              : material.kind === 'flashcards' || material.kind === 'quiz'
          )
          .map((value): Item => ({ type: 'material', value }))
      ];

      items.sort((a, b) => {
        const at = a.type === 'source' ? a.value.createdAt : a.value.updated_at;
        const bt = b.type === 'source' ? b.value.createdAt : b.value.updated_at;

        return at === bt ? 0 : at > bt ? -1 : 1;
      });

      if (!controller.signal.aborted) setState({ key, items });
    };

    void load().catch(() => {
      if (!controller.signal.aborted) setState({ key, error: true });
    });
    const onFocus = () => setRefresh((value) => value + 1);

    window.addEventListener('focus', onFocus);

    return () => {
      controller.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [section, projectIds, project, blocked, ready, key, refresh]);

  if (blocked) return null;

  const current = state?.key === key ? state : undefined;

  if (current?.error)
    return (
      <Button variant="ghost-muted" onClick={() => setRefresh((value) => value + 1)}>
        {t('StudyLoadError')}
      </Button>
    );

  if (!current?.items) return <Sidebar.Message role="status">{t('LoadingStudy')}</Sidebar.Message>;

  const items = current.items.filter(
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
            ? selected.get('id') === String(item.value.id) && !selected.has('material')
            : selected.get('material') === String(item.value.id);

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
