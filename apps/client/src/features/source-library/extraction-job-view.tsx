import type { SourceId, executionIdSchema } from '@study/contracts';
import { Button, SourceReader, StatusMessage } from '@study/ui';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

import { useAgentProgress } from '../agent-progress';
import type { ExtractionJob } from './extraction-job';
import { ProcessingRetry } from './processing-retry';

export function ExtractionSummary({
  sourceId,
  job,
  allowRetry
}: {
  sourceId: SourceId;
  job: ExtractionJob;
  allowRetry: boolean;
}) {
  const { t } = useI18n();

  return (
    <SourceReader.ExtractionSummary>
      <StatusMessage data-material-extraction-status={job.status}>{t(job.summary)}</StatusMessage>
      {job.status === 'waiting' && (
        <Button size="sm" variant="ghost" render={<Link to="/settings" />}>
          {t('Settings')}
        </Button>
      )}
      {allowRetry && job.retryRevision !== undefined && (
        <ProcessingRetry sourceId={sourceId} revision={job.retryRevision} />
      )}
    </SourceReader.ExtractionSummary>
  );
}

export function ExtractionDetails({ sourceId, job }: { sourceId: SourceId; job: ExtractionJob }) {
  const { t, date } = useI18n();
  const updatedAt = job.updatedAtMs !== undefined ? new Date(job.updatedAtMs) : undefined;

  return (
    <SourceReader.Details heading={t('MaterialExtractionHeading')}>
      <SourceReader.Detail
        label={t('MaterialExtractionStatus')}
        value={<ExtractionSummary sourceId={sourceId} job={job} allowRetry />}
      />
      {job.runningExecutionId && <ExtractionStage executionId={job.runningExecutionId} />}
      {updatedAt && Number.isFinite(updatedAt.getTime()) && (
        <SourceReader.Detail
          label={t('MaterialExtractionUpdated')}
          value={
            <time dateTime={updatedAt.toISOString()}>
              {date(updatedAt.getTime() / 1000, { dateStyle: 'medium', timeStyle: 'short' })}
            </time>
          }
        />
      )}
      {job.retained && (
        <SourceReader.Detail
          label={t('MaterialExtractionEarlier')}
          value={t('MaterialExtractionRetained')}
        />
      )}
    </SourceReader.Details>
  );
}

const stageLabels = {
  preparing: 'AgentActivityPreparing',
  compacting: 'AgentActivityCompacting',
  generating: 'MaterialExtractionModelRunning'
} as const;

function ExtractionStage({ executionId }: { executionId: typeof executionIdSchema.Type }) {
  const { t } = useI18n();
  const { runs } = useAgentProgress({ executionId });
  const current = runs.findLast(
    (run) => run.status === 'running' && run.executionStatus === 'running'
  );

  if (!current?.phase) return null;

  return (
    <SourceReader.Detail
      label={t('MaterialExtractionStage')}
      value={t(stageLabels[current.phase])}
    />
  );
}
