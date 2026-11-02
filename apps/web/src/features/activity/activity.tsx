import type { ErrorKind } from '@study/contracts/errors';
import type { executionSchema, executionsPageSchema } from '@study/contracts/workflows/schemas';
import type { StaticMessageKey } from '@study/localization';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Activity as ActivityIcon,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  FileText,
  ScanText,
  ChevronDown,
  Clock3,
  RefreshCw
} from 'lucide-react';
import { useState } from 'react';

import './activity.css';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';

type Execution = typeof executionSchema.Type;
type Cursor = typeof executionsPageSchema.Type.next;
const workflowLabels: Readonly<Partial<Record<string, StaticMessageKey>>> = {
  'source-ingestion': 'workspace.task.source-ingestion',
  'source-correction': 'workspace.task.source-correction',
  'source-material-projection': 'workspace.task.source-material-projection',
  'material-generation': 'workspace.task.material-generation',
  'conversation-reply': 'workspace.task.conversation-reply',
  'conversation-title': 'workspace.task.conversation-title',
  'conversation-attachment-wake': 'workspace.task.conversation-attachment-wake',
  'recording-post': 'workspace.task.recording-post',
  'quiz-grading': 'workspace.task.quiz-grading',
  'practice-slot': 'workspace.task.practice-slot',
  'practice-failure': 'workspace.task.practice-failure',
  'practice-publication': 'workspace.task.practice-publication',
  'material-history-prune': 'workspace.task.material-history-prune',
  'session-deletion': 'workspace.task.session-deletion',
  'material-deletion': 'workspace.task.material-deletion'
};

const failureGuidance: Readonly<Record<ErrorKind, StaticMessageKey>> = {
  auth: 'workspace.failure.auth',
  cancelled: 'workspace.failure.cancelled',
  config: 'workspace.failure.config',
  internal: 'workspace.failure.internal',
  invalid_input: 'workspace.failure.invalid_input',
  model_unavailable: 'workspace.failure.model_unavailable',
  not_enough: 'workspace.failure.not_enough',
  not_found: 'workspace.failure.not_found',
  rate_limited: 'workspace.failure.rate_limited',
  transient: 'workspace.failure.transient',
  unsupported: 'workspace.failure.unsupported'
};

export function activityState(item: Execution) {
  return item.outcome === 'failure' ? 'failure' : item.status;
}
export function Activity() {
  const { t, date } = useI18n();
  const client = useQueryClient();
  const [selected, select] = useState<Execution['id']>();
  const list = useInfiniteQuery({
    queryKey: ['activity', 'pages'],
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) =>
      request(
        (c) => c['workflows.executions']({ limit: 20, before: pageParam ?? undefined }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 5000
  });
  const detail = useQuery({
    queryKey: ['activity', selected],
    enabled: selected !== undefined,
    queryFn: ({ signal }) => request((c) => c['workflows.execution']({ id: selected! }), signal),
    refetchInterval: 5000
  });
  const cancel = useMutation({
    mutationFn: (id: Execution['id']) =>
      request((c) => c['workflows.cancelExecution']({ id, mode: 'safe' })),
    onSettled: () => client.invalidateQueries({ queryKey: ['activity'] })
  });
  return (
    <div className="activity-page">
      <div className="activity-body">
        <Settings.Section
          title={t('workspace.activityTitle')}
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={list.isFetching}
              onClick={() => void list.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              {t('collections.retry')}
            </Button>
          }
        >
          <Settings.Group>
            {list.isPending && <Loading layout="panel" label={t('collections.loading')} />}
            {list.isError && <ErrorState title={t('collections.readError')} />}
            {!list.isError && list.data?.pages.every((page) => page.items.length === 0) && (
              <div className="activity-empty">
                <ol className="activity-flow">
                  <li className="activity-flow-step">
                    <div className="activity-flow-preview activity-flow-files" aria-hidden="true">
                      <span className="activity-file-back">
                        <AudioLines />
                      </span>
                      <span className="activity-file-front">
                        <FileText />
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                    <span>{t('workspace.activityImport')}</span>
                    <p>{t('workspace.activityImportHelp')}</p>
                    <ArrowRight className="activity-flow-arrow" aria-hidden="true" />
                  </li>
                  <li className="activity-flow-step">
                    <div
                      className="activity-flow-preview activity-flow-processing"
                      aria-hidden="true"
                    >
                      <span className="activity-scan">
                        <ScanText />
                      </span>
                      <span className="activity-scan-lines">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                    <span>{t('workspace.activityProcess')}</span>
                    <p>{t('workspace.activityProcessHelp')}</p>
                    <ArrowRight className="activity-flow-arrow" aria-hidden="true" />
                  </li>
                  <li className="activity-flow-step">
                    <div className="activity-flow-preview activity-flow-result" aria-hidden="true">
                      <span className="activity-result">
                        <BookOpen />
                        <i />
                        <i />
                      </span>
                      <span className="activity-result-check">
                        <Check />
                      </span>
                    </div>
                    <span>{t('workspace.activityReady')}</span>
                    <p>{t('workspace.activityReadyHelp')}</p>
                  </li>
                </ol>
                <div className="activity-empty-footer">
                  <div className="activity-empty-copy">
                    <h4>{t('workspace.activityEmptyTitle')}</h4>
                    <p>{t('workspace.activityEmpty')}</p>
                  </div>
                  <Button variant="outline" size="sm" render={<Link to="/sessions" />}>
                    {t('workspace.activityOpenSessions')}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
            <ul className="activity-list">
              {list.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.id} className="activity-item">
                    <Button
                      variant="ghost"
                      aria-expanded={selected === item.id}
                      onClick={() => select(selected === item.id ? undefined : item.id)}
                      className="activity-row"
                    >
                      <span className="activity-task-icon" aria-hidden="true">
                        <ActivityIcon />
                      </span>
                      <span className="activity-row-copy">
                        {t(workflowLabels[item.workflow] ?? 'workspace.task.other')}
                        <time>
                          {item.createdAtMs >= -8_640_000_000_000_000n &&
                          item.createdAtMs <= 8_640_000_000_000_000n
                            ? date(item.createdAtMs / 1000n)
                            : t('workspace.dateUnavailable')}
                        </time>
                      </span>
                      <span className="activity-state" data-state={activityState(item)}>
                        {t(`workspace.state.${activityState(item)}`)}
                      </span>
                      <ChevronDown className="activity-chevron" aria-hidden="true" />
                    </Button>
                    {selected === item.id && (
                      <div className="activity-detail">
                        {detail.isPending && <Loading label={t('collections.loading')} />}
                        {detail.isError && (
                          <ErrorState
                            title={t('collections.readError')}
                            action={
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void detail.refetch()}
                              >
                                {t('collections.retry')}
                              </Button>
                            }
                          />
                        )}
                        {detail.data && !detail.isError && (
                          <>
                            <p className="activity-state" data-state={activityState(detail.data)}>
                              {t(`workspace.state.${activityState(detail.data)}`)}
                            </p>
                            {detail.data.outcome === 'failure' && (
                              <p className="max-w-prose text-muted-foreground">
                                {t(failureGuidance[detail.data.failureKind ?? 'internal'])}
                              </p>
                            )}
                            <details>
                              <summary>{t('workspace.details')}</summary>
                              <dl className="activity-metadata">
                                <dt>{t('workspace.execution')}</dt>
                                <dd>{detail.data.id}</dd>
                                <dt>{t('workspace.workflow')}</dt>
                                <dd>{detail.data.workflow}</dd>
                                {detail.data.correlationId && (
                                  <>
                                    <dt>{t('workspace.context')}</dt>
                                    <dd>{detail.data.correlationId}</dd>
                                  </>
                                )}
                              </dl>
                            </details>
                            {detail.data.canCancel && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={cancel.isPending}
                                onClick={() => cancel.mutate(detail.data.id)}
                              >
                                {t('collections.cancel')}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </Settings.Group>
          <p className="activity-update-note">
            <Clock3 aria-hidden="true" />
            {t('workspace.activityHelp')}
          </p>
        </Settings.Section>
        {cancel.isError && <ErrorState title={t('workspace.cancelError')} />}
        {list.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            disabled={list.isFetching}
            onClick={() => void list.fetchNextPage()}
          >
            {t('collections.more')}
          </Button>
        )}
      </div>
    </div>
  );
}
