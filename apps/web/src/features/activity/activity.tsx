import type { ErrorKind } from '@study/contracts/errors';
import type { executionSchema } from '@study/contracts/workflows/schemas';
import type { StaticMessageKey } from '@study/localization';
import { ActivityPanel } from '@study/ui/activity';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import type { UseQueryResult } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity as ActivityIcon, ArrowRight, Clock3, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import {
  activityPagesOptions,
  activityExecutionOptions,
  cancelExecutionOptions
} from './activity.queries';
import { workflowLabel } from './workflow-label';

type Execution = typeof executionSchema.Type;

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
  const list = useInfiniteQuery(activityPagesOptions());
  const detail = useQuery(activityExecutionOptions(selected));
  const cancel = useMutation({
    ...cancelExecutionOptions(),
    onSettled: () => client.invalidateQueries({ queryKey: ['activity'] })
  });

  return (
    <ActivityPanel.Root>
      <ActivityPanel.Body>
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
              <ActivityPanel.Empty
                stages={[
                  {
                    title: t('workspace.activityImport'),
                    description: t('workspace.activityImportHelp')
                  },
                  {
                    title: t('workspace.activityProcess'),
                    description: t('workspace.activityProcessHelp')
                  },
                  {
                    title: t('workspace.activityReady'),
                    description: t('workspace.activityReadyHelp')
                  }
                ]}
              >
                <div>
                  <h4>{t('workspace.activityEmptyTitle')}</h4>
                  <p>{t('workspace.activityEmpty')}</p>
                </div>
                <Button variant="outline" size="sm" render={<Link to="/sessions" />}>
                  {t('workspace.activityOpenSessions')}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </ActivityPanel.Empty>
            )}
            <ActivityPanel.List>
              {list.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <ActivityPanel.Item key={item.id}>
                    <ActivityPanel.Toggle
                      aria-expanded={selected === item.id}
                      onClick={() => select(selected === item.id ? undefined : item.id)}
                    >
                      <ActivityPanel.Icon aria-hidden="true">
                        <ActivityIcon />
                      </ActivityPanel.Icon>
                      <ActivityPanel.Copy>
                        {t(workflowLabel(item.workflow))}
                        <time>
                          {item.createdAtMs >= -8_640_000_000_000_000n &&
                          item.createdAtMs <= 8_640_000_000_000_000n
                            ? date(item.createdAtMs / 1000n)
                            : t('workspace.dateUnavailable')}
                        </time>
                      </ActivityPanel.Copy>
                      <ActivityPanel.State state={activityState(item)}>
                        {t(`workspace.state.${activityState(item)}`)}
                      </ActivityPanel.State>
                      <ActivityPanel.Chevron />
                    </ActivityPanel.Toggle>
                    {selected === item.id && <ActivityDetail detail={detail} cancel={cancel} />}
                  </ActivityPanel.Item>
                ))}
            </ActivityPanel.List>
          </Settings.Group>
          <ActivityPanel.UpdateNote>
            <Clock3 aria-hidden="true" />
            {t('workspace.activityHelp')}
          </ActivityPanel.UpdateNote>
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
      </ActivityPanel.Body>
    </ActivityPanel.Root>
  );
}

function ActivityDetail({
  detail,
  cancel
}: {
  detail: UseQueryResult<Execution>;
  cancel: { isPending: boolean; mutate: (id: Execution['id']) => void };
}) {
  const { t } = useI18n();

  return (
    <ActivityPanel.Detail>
      {detail.isPending && <Loading label={t('collections.loading')} />}
      {detail.isError && (
        <ErrorState
          title={t('collections.readError')}
          action={
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              {t('collections.retry')}
            </Button>
          }
        />
      )}
      {detail.data && !detail.isError && (
        <>
          <ActivityPanel.State state={activityState(detail.data)}>
            {t(`workspace.state.${activityState(detail.data)}`)}
          </ActivityPanel.State>
          {detail.data.outcome === 'failure' && (
            <ErrorState
              title={t('workspace.state.failure')}
              description={t(failureGuidance[detail.data.failureKind ?? 'internal'])}
            />
          )}
          <details>
            <summary>{t('workspace.details')}</summary>
            <ActivityPanel.Metadata>
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
            </ActivityPanel.Metadata>
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
    </ActivityPanel.Detail>
  );
}
