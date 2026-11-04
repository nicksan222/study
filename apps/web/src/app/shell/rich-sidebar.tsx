import type { SessionDto } from '@study/contracts/conversations/schemas';
import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Spinner } from '@study/ui/spinner';
import { Link } from '@tanstack/react-router';
import { FileText, MessagesSquare, SquareDashed, ChevronDown, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  SessionDocumentDialog,
  SessionBatchDeleteDialog
} from '#web/features/session-workspace/index.ts';
import type { SelectedSession } from '#web/features/session-workspace/index.ts';
import { SubjectIdentity } from '#web/features/subjects/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { useSidebarProgress, useSessionSettlement } from './rich-sidebar.queries';
import { SidebarSessionActions } from './sidebar-session-actions';
import type { SidebarModel } from './use-sidebar';

type Props = Pick<SidebarModel, 'project' | 'selectedSession' | 'subjects' | 'sessions'>;

type Progress = NonNullable<
  ReturnType<typeof useSidebarProgress>['progress']['data']
>['items'][number];

/** Groups sessions using persisted overrides, document counts, and running work. */

export function RichSidebarSessions(props: Props) {
  return <SidebarSessionList key={String(props.project)} {...props} />;
}

function SidebarSessionList(props: Props) {
  const { t } = useI18n();
  const { settings, progress } = useSidebarProgress();
  const selectionToolbar = useRef<HTMLDivElement>(null);
  const sessionRows = useRef<HTMLDivElement>(null);
  const selectionOrigin = useRef<string | undefined>(undefined);
  const [selected, setSelected] = useState<SelectedSession[] | null>(null);
  const [action, setAction] = useState<{
    kind: 'document' | 'delete';
    sessions: SelectedSession[];
  } | null>(null);
  const selection: SelectionControls = {
    items: selected,
    start: (session) => {
      selectionOrigin.current = String(session.id);
      setSelected([{ id: session.id, title: session.title }]);
    },
    toggle: (session) =>
      setSelected((current) => {
        const items = current ?? [];

        return items.some((item) => item.id === session.id)
          ? items.filter((item) => item.id !== session.id)
          : [...items, { id: session.id, title: session.title }];
      })
  };
  const selecting = selected !== null;

  useEffect(() => {
    if (selecting) selectionToolbar.current?.focus();
    else if (selectionOrigin.current) {
      sessionRows.current
        ?.querySelector<HTMLElement>(`[data-session-id="${selectionOrigin.current}"]`)
        ?.focus();
    }
  }, [selecting]);
  const threshold = settings.data?.settledDocumentThreshold ?? 1;
  const summaries = new Map(progress.data?.items.map((item) => [String(item.id), item]));
  const settled = (session: SessionDto) => {
    const summary = summaries.get(String(session.id));

    return (
      !!summary &&
      !summary.running &&
      (summary.settledOverride ?? summary.generatedDocumentCount >= BigInt(threshold))
    );
  };
  const open = props.sessions.filter((session) => !settled(session));
  const complete = props.sessions.filter(settled);

  return (
    <>
      {selected && (
        <SidebarUI.SelectionBar
          ref={selectionToolbar}
          tabIndex={-1}
          role="toolbar"
          aria-label={t('SidebarSelectionActions')}
        >
          <SidebarUI.SelectionCount
            count={selected.length}
            label={t('SidebarSelectedCount', { count: selected.length })}
          />
          <Button
            size="sm"
            aria-label={t('SessionCreateDocument')}
            title={t('SessionCreateDocument')}
            disabled={!selected.length}
            onClick={() => setAction({ kind: 'document', sessions: [...selected] })}
          >
            <FileText aria-hidden="true" />
            {t('SessionCreateDocument')}
          </Button>
          <Button
            size="sm"
            variant="ghost-destructive"
            aria-label={t('SidebarDeleteSelected')}
            title={t('SidebarDeleteSelected')}
            disabled={!selected.length}
            onClick={() => setAction({ kind: 'delete', sessions: [...selected] })}
          >
            <Trash2 aria-hidden="true" />
            <span data-selection-action-label>{t('SidebarDeleteSelected')}</span>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label={t('Cancel')}
            title={t('Cancel')}
            onClick={() => setSelected(null)}
          >
            <X aria-hidden="true" />
          </Button>
        </SidebarUI.SelectionBar>
      )}
      <SidebarUI.SessionGroups ref={sessionRows}>
        <SidebarUI.SessionGroup title={t('SidebarOpen')} count={open.length} defaultOpen>
          {open.map((session) => (
            <RichSession
              key={String(session.id)}
              {...props}
              session={session}
              progress={summaries.get(String(session.id))}
              settled={false}
              selection={selection}
            />
          ))}
        </SidebarUI.SessionGroup>
        <SettledSessions
          key={String(props.project)}
          {...props}
          sessions={complete}
          summaries={summaries}
          selection={selection}
        />
      </SidebarUI.SessionGroups>
      {action?.kind === 'document' && action.sessions[0] && (
        <SessionDocumentDialog
          id={action.sessions[0].id}
          sessions={action.sessions}
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
        />
      )}
      {action?.kind === 'delete' && (
        <SessionBatchDeleteDialog
          sessions={action.sessions}
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          onDeleted={(ids) => {
            setSelected((current) => {
              const remaining = current?.filter((item) => !ids.includes(item.id)) ?? [];

              return remaining.length ? remaining : null;
            });
          }}
        />
      )}
    </>
  );
}

/** Keeps completed work scannable while revealing older sessions in deliberate batches. */

function SettledSessions(
  props: Props & { summaries: Map<string, Progress>; selection: SelectionControls }
) {
  const { t } = useI18n();
  const rows = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(0);
  const preview = useSettledPreview(rows, props.sessions.length);
  const visible = preview + extra;
  const sessions = props.sessions.toSorted((a, b) =>
    a.updatedAt === b.updatedAt ? 0 : a.updatedAt > b.updatedAt ? -1 : 1
  );
  const more = Math.min(25, Math.max(0, sessions.length - visible));

  return (
    <SidebarUI.SessionGroup title={t('SidebarSettled')} count={sessions.length} variant="settled">
      <SidebarUI.SettledRows ref={rows}>
        {sessions.slice(0, visible).map((session) => (
          <RichSession
            key={String(session.id)}
            {...props}
            session={session}
            progress={props.summaries.get(String(session.id))}
            settled
          />
        ))}
      </SidebarUI.SettledRows>
      {more > 0 && (
        <SidebarUI.SessionMore onClick={() => setExtra((count) => count + 25)}>
          <ChevronDown aria-hidden="true" />
          {t('SidebarShowMore', { count: more })}
        </SidebarUI.SessionMore>
      )}
    </SidebarUI.SessionGroup>
  );
}

type SelectionControls = {
  items: readonly SelectedSession[] | null;
  start: (session: SessionDto) => void;
  toggle: (session: SessionDto) => void;
};

type RowProps = Props & {
  session: SessionDto;
  progress?: Progress;
  settled: boolean;
  selection: SelectionControls;
};

/** Fit the initial preview to the bottom half before offering older completed work. */

function useSettledPreview(rows: { current: HTMLDivElement | null }, count: number) {
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const list = rows.current;
    const available = list?.closest('.study-sidebar-scroll');
    const summary = list?.closest('details')?.querySelector('summary');

    if (!list || !available || !summary || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const row = list.firstElementChild?.getBoundingClientRect().height ?? 0;
      const height = available.getBoundingClientRect().height;

      if (!row || !height) return;

      const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
      const summaryHeight = summary.getBoundingClientRect().height;
      const capacity = Math.floor((height / 2 - summaryHeight) / (row + gap));
      const withMore = Math.floor((height / 2 - summaryHeight - row) / (row + gap));

      setLimit(Math.max(1, Math.min(10, count <= capacity ? capacity : withMore)));
    };
    const observer = new ResizeObserver(measure);

    observer.observe(available);
    observer.observe(list);
    measure();

    return () => observer.disconnect();
  }, [rows, count]);

  return limit;
}

/** Keeps settlement actions separate from navigation and disabled during active work. */

function RichSession(props: RowProps) {
  const { t } = useI18n();
  const settlement = useSessionSettlement(props.session.id);

  return (
    <SidebarUI.SessionEntry
      data-settled={props.settled || undefined}
      data-selecting={props.selection.items !== null || undefined}
    >
      <SessionLink {...props} />
      {!props.selection.items && (
        <SidebarUI.SettleAction
          disabled={settlement.isPending || !!props.progress?.running}
          onClick={(event) => {
            event.stopPropagation();
            settlement.mutate(!props.settled);
          }}
        >
          {t(props.settled ? 'SidebarReopen' : 'SidebarSettle')}
        </SidebarUI.SettleAction>
      )}
      {settlement.error && (
        <SidebarUI.Message role="alert">{t('SidebarSettlementError')}</SidebarUI.Message>
      )}
    </SidebarUI.SessionEntry>
  );
}

/** Renders subject identity, selection, and progress for one session destination. */

function SessionLink({
  session,
  project,
  subjects,
  selectedSession,
  progress,
  settled,
  selection
}: RowProps) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const owner = subjects.find(
    (item) =>
      session.projectIds.includes(item.id) &&
      (item.id === project || session.projectIds[0] === item.id)
  );

  return (
    <SidebarSessionActions
      id={session.id}
      project={project ? String(project) : undefined}
      onSelect={() => selection.start(session)}
    >
      <SidebarUI.Item
        layout={
          settled ? 'summary' : preferences.sidebarDensity === 'compact' ? 'compact' : 'detailed'
        }
        label={session.title}
        data-session-id={String(session.id)}
        context={owner?.name ?? t('Sessions')}
        icon={<SessionRowIcon owner={owner} settled={settled} />}
        timestamp={<SessionTime at={session.updatedAt} />}
        selection={selection.items?.some((item) => item.id === session.id)}
        description={settled ? undefined : <SessionProgress progress={progress} />}
        aria-label={session.title}
        aria-current={selectedSession === String(session.id) ? 'page' : undefined}
        title={session.title}
        render={sessionDestination(session, project, selection)}
      />
    </SidebarSessionActions>
  );
}

function SessionRowIcon({
  owner,
  settled
}: {
  owner: Props['subjects'][number] | undefined;
  settled: boolean;
}) {
  if (owner) return <SubjectIdentity name={owner.name} icon={owner.icon} />;

  return settled ? <SquareDashed aria-hidden="true" /> : <MessagesSquare aria-hidden="true" />;
}

function sessionDestination(
  session: SessionDto,
  project: Props['project'],
  selection: SelectionControls
) {
  if (selection.items !== null)
    return (
      <button type="button" aria-label={session.title} onClick={() => selection.toggle(session)} />
    );

  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
      search={project ? { project: String(project) } : {}}
    />
  );
}

/** Refreshes the displayed age without changing the stored timestamp. */

function SessionTime({ at }: { at: bigint }) {
  const { locale, date } = useI18n();
  const now = useNowMinute();
  const preferences = useWorkspacePreferences();

  return (
    <time dateTime={new Date(Number(at) * 1000).toISOString()} title={date(at)}>
      {preferences.sidebarTimeFormat === 'absolute' ? date(at) : age(locale, now - Number(at))}
    </time>
  );
}

/** Shows workflow activity and retained generated-document counts. */

function SessionProgress({ progress }: { progress?: Progress }) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const labels = {
    idle: 'SidebarReady',
    generating: 'SidebarGenerating',
    processing: 'SidebarProcessing',
    answering: 'SidebarWriting'
  } as const;
  const label = progress ? labels[progress.activity] : 'SidebarStatusUnavailable';

  return (
    <>
      <SidebarUI.SessionActivity running={progress?.running} title={t(label)}>
        {progress?.running && <Spinner size="xs" label={t(label)} aria-hidden="true" />}
        <span>{t(label)}</span>
      </SidebarUI.SessionActivity>
      {preferences.sidebarShowDocumentCounts && <SessionDocumentCount progress={progress} />}
    </>
  );
}

/** Reuses the document count in both detailed and compact session rows. */

function SessionDocumentCount({ progress }: { progress?: Progress }) {
  const { t } = useI18n();

  return (
    <SidebarUI.SessionCount title={t('SidebarGeneratedDocuments')}>
      <FileText size={12} aria-hidden="true" />
      {progress ? String(progress.generatedDocumentCount) : '—'}
    </SidebarUI.SessionCount>
  );
}
