import type { ProjectId } from '@study/contracts/ids';
import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Practice } from '@study/ui/practice';
import { WorkspaceCard } from '@study/ui/workspace';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowUpRight, GraduationCap, Layers, NotebookPen } from 'lucide-react';

import { libraryQueryOptions } from '#web/features/library/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import type { Materials, Subjects } from '#web/lib/study-client/operations.ts';
import { projectsQueryOptions } from '#web/lib/study-client/study.queries.ts';

import { PracticeWorkspace, PracticeSubject } from './workspace';

export function LibraryPage({ kind }: { kind?: 'flashcards' }) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const projects = useQuery(projectsQueryOptions());
  const project = projects.data?.find((item) => String(item.id) === search.project);
  const ready = projects.isSuccess && (!search.project || Boolean(project));

  return (
    <PracticeWorkspace
      title={t(kind ? 'Flashcards' : 'Practice')}
      parent={project && <PracticeSubject project={project} />}
      actions={<LibraryActions ready={ready} project={project?.id} />}
    >
      <Practice.Library>
        <Practice.LibraryHeading>
          <h2>{t(kind ? 'PracticeFlashcardsTitle' : 'PracticeLibraryTitle')}</h2>
          <p>{t(kind ? 'PracticeFlashcardsIntro' : 'PracticeLibraryIntro')}</p>
        </Practice.LibraryHeading>
        {projects.isPending ? (
          <Loading label={t('LoadingPractice')} />
        ) : projects.isError ? (
          <ErrorState
            title={t('PracticeLoadError')}
            action={<Button onClick={() => void projects.refetch()}>{t('LibraryRefresh')}</Button>}
          />
        ) : (
          <LibraryContent kind={kind} subjects={projects.data} project={search.project} />
        )}
      </Practice.Library>
    </PracticeWorkspace>
  );
}

function LibraryContent({
  kind,
  subjects,
  project
}: {
  kind?: 'flashcards';
  subjects: Subjects;
  project?: string;
}) {
  const { t } = useI18n();
  const selected = subjects.find((item) => String(item.id) === project);
  const invalid = Boolean(project) && !selected;
  const library = useQuery(libraryQueryOptions(subjects, selected?.id, !invalid));

  if (invalid) return <ErrorState title={t('ReaderUnavailable')} />;

  if (library.isPending) return <Loading label={t('LoadingPractice')} />;

  if (library.isError)
    return (
      <ErrorState
        title={t('PracticeLoadError')}
        action={<Button onClick={() => void library.refetch()}>{t('LibraryRefresh')}</Button>}
      />
    );

  const items = library.data.filter((item) => !kind || item.value.kind === kind);

  if (!items.length) return <LibraryEmpty project={project} />;

  return (
    <Practice.LibraryList>
      {items.map(({ value }) => (
        <LibraryRow key={String(value.id)} value={value} subjects={subjects} project={project} />
      ))}
    </Practice.LibraryList>
  );
}

function LibraryEmpty({ project }: { project?: string }) {
  const { t } = useI18n();

  return (
    <Practice.Empty>
      <GraduationCap aria-hidden="true" />
      <h3>{t('PracticeLibraryEmpty')}</h3>
      <p>{t('PracticeLibraryEmptyHint')}</p>
      <Button
        variant="outline"
        render={<Link to="/documents" search={project ? { project } : {}} />}
      >
        {t('SourceDocument')}
      </Button>
    </Practice.Empty>
  );
}

function LibraryRow({
  value,
  subjects,
  project
}: {
  value: Materials[number];
  subjects: Subjects;
  project?: string;
}) {
  const { t, locale } = useI18n();
  const now = useNowMinute();
  const flashcards = value.kind === 'flashcards';
  const Icon = flashcards ? Layers : GraduationCap;
  const owner = subjects.find((item) => value.projectIds.includes(item.id));
  const scope = project ?? owner?.id.toString();

  return (
    <Link
      className="study-practice-library-row"
      to={flashcards ? '/flashcards/$materialId' : '/practice/$materialId'}
      params={{ materialId: String(value.id) }}
      search={scope ? { project: scope } : {}}
    >
      <Practice.LibraryIconText>
        <Icon aria-hidden="true" />
      </Practice.LibraryIconText>
      <Practice.LibraryLabelText>
        <strong>{value.title}</strong>
        <span>
          {t(flashcards ? 'Flashcards' : 'SidebarQuiz')}
          {owner && <> · {owner.name}</>}
        </span>
      </Practice.LibraryLabelText>
      <Practice.LibraryAgeText>
        {age(locale, now - Number(value.updated_at))}
      </Practice.LibraryAgeText>
      <ArrowUpRight aria-hidden="true" />
    </Link>
  );
}

function LibraryActions({ ready, project }: { ready: boolean; project?: ProjectId }) {
  const { t } = useI18n();

  if (!ready) return null;

  return (
    <WorkspaceCard.Group>
      <WorkspaceCard.Item
        render={<Link to="/documents" search={project ? { project: String(project) } : {}} />}
      >
        <NotebookPen aria-hidden="true" />
        <span>{t('SourceDocument')}</span>
      </WorkspaceCard.Item>
    </WorkspaceCard.Group>
  );
}
