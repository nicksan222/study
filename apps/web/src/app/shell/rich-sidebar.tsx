import type { SessionDto } from '@study/contracts/conversations/schemas';
import { age } from '@study/localization';
import { useNowMinute } from '@study/ui/clock';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Spinner } from '@study/ui/spinner';
import { Link } from '@tanstack/react-router';
import { FileText, MessagesSquare } from 'lucide-react';

import { SubjectIdentity } from '../../features/subjects';
import { useI18n } from '../../lib/i18n';
import { useWorkspacePreferences } from '../../lib/study-client/workspace-preferences.queries';
import { useSidebarProgress, useSessionSettlement } from './rich-sidebar.queries';
import { SidebarSessionActions } from './sidebar-session-actions';
import type { SidebarModel } from './use-sidebar';

type Props = Pick<SidebarModel, 'project' | 'selectedSession' | 'subjects' | 'sessions'>;

type Progress = NonNullable<
  ReturnType<typeof useSidebarProgress>['progress']['data']
>['items'][number];

/** Groups sessions using persisted overrides, document counts, and running work. */
export function RichSidebarSessions(props: Props) {
  const { t } = useI18n();
  const { settings, progress } = useSidebarProgress();
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
    <SidebarUI.SessionGroups>
      <SidebarUI.SessionGroup title={t('SidebarOpen')} count={open.length} defaultOpen>
        {open.map((session) => (
          <RichSession
            key={String(session.id)}
            {...props}
            session={session}
            progress={summaries.get(String(session.id))}
            settled={false}
          />
        ))}
      </SidebarUI.SessionGroup>
      <SidebarUI.SessionGroup title={t('SidebarSettled')} count={complete.length}>
        {complete.map((session) => (
          <RichSession
            key={String(session.id)}
            {...props}
            session={session}
            progress={summaries.get(String(session.id))}
            settled
          />
        ))}
      </SidebarUI.SessionGroup>
    </SidebarUI.SessionGroups>
  );
}

type RowProps = Props & { session: SessionDto; progress?: Progress; settled: boolean };

/** Keeps settlement actions separate from navigation and disabled during active work. */
function RichSession(props: RowProps) {
  const { t } = useI18n();
  const settlement = useSessionSettlement(props.session.id);

  return (
    <SidebarUI.SessionEntry>
      <SessionLink {...props} />
      <SidebarUI.SettleAction
        disabled={settlement.isPending || !!props.progress?.running}
        onClick={(event) => {
          event.stopPropagation();
          settlement.mutate(!props.settled);
        }}
      >
        {t(props.settled ? 'SidebarReopen' : 'SidebarSettle')}
      </SidebarUI.SettleAction>
      {settlement.error && (
        <SidebarUI.Message role="alert">{t('SidebarSettlementError')}</SidebarUI.Message>
      )}
    </SidebarUI.SessionEntry>
  );
}

/** Renders subject identity, selection, and progress for one session destination. */
function SessionLink({ session, project, subjects, selectedSession, progress }: RowProps) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const owner = subjects.find(
    (item) =>
      session.projectIds.includes(item.id) &&
      (item.id === project || session.projectIds[0] === item.id)
  );

  return (
    <SidebarSessionActions id={session.id} project={project ? String(project) : undefined}>
      <SidebarUI.Item
        layout={preferences.sidebarDensity === 'compact' ? 'compact' : 'detailed'}
        label={session.title}
        context={owner?.name ?? t('Sessions')}
        icon={
          owner ? (
            <SubjectIdentity name={owner.name} icon={owner.icon} />
          ) : (
            <MessagesSquare aria-hidden="true" />
          )
        }
        timestamp={<SessionTime at={session.updatedAt} />}
        description={<SessionProgress progress={progress} />}
        aria-label={session.title}
        aria-current={selectedSession === String(session.id) ? 'page' : undefined}
        title={session.title}
        render={
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: session.id }}
            search={project ? { project: String(project) } : {}}
          />
        }
      />
    </SidebarSessionActions>
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
      <SidebarUI.SessionActivity running={progress?.running}>
        {progress?.running && <Spinner size="xs" label={t(label)} aria-hidden="true" />}
        {t(label)}
      </SidebarUI.SessionActivity>
      {preferences.sidebarShowDocumentCounts && (
        <SidebarUI.SessionCount title={t('SidebarGeneratedDocuments')}>
          <FileText size={12} aria-hidden="true" />
          {progress ? String(progress.generatedDocumentCount) : '—'}
        </SidebarUI.SessionCount>
      )}
    </>
  );
}
