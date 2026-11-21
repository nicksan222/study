import { isRetryable } from '@study/contracts';
import type {
  executionSchema,
  importCapabilitySchema,
  sourceProcessingJobSchema
} from '@study/contracts';
import type { StaticMessageKey } from '@study/localization';

type Execution = typeof executionSchema.Type;

type Processing = typeof sourceProcessingJobSchema.Type;

type Capability = typeof importCapabilitySchema.Type;

const statusLabels = {
  loading: 'MaterialExtractionLoading',
  unavailable: 'UploadedMaterialsStatusUnavailable',
  idle: 'MaterialExtractionIdle',
  queued: 'MaterialExtractionQueued',
  running: 'MaterialExtractionRunning',
  suspended: 'MaterialExtractionSuspended',
  waiting: 'UploadedMaterialsWaiting',
  cancelling: 'MaterialExtractionCancelling',
  cancelled: 'MaterialExtractionCancelled',
  failed: 'SourceExtractionFailed',
  unsupported: 'SourceExtractionUnsupported',
  complete: 'MaterialExtractionComplete'
} as const;

type Status = keyof typeof statusLabels;

export type ExtractionJob = {
  status: Status;
  summary: StaticMessageKey;
  sidebar: StaticMessageKey;
  retained: boolean;
  retryRevision?: number;
  updatedAtMs?: number;
  runningExecutionId?: Execution['id'];
};

const waitLabels = {
  auth: 'NoteWaitAuth',
  config: 'NoteWaitConfig',
  model_unavailable: 'NoteWaitModel'
} as const;

const sidebarLabels: Partial<Record<Status, ExtractionJob['sidebar']>> = {
  complete: 'UploadedMaterialsReady',
  failed: 'UploadedMaterialsFailed',
  unsupported: 'MaterialOriginalOnly'
} as const;

export function isPublished(processing: Processing | undefined) {
  return !!processing?.documentId && processing.requestId === processing.publishedRequestId;
}

function executionStatus(execution: Execution): Status {
  if (execution.status === 'cancelled' || execution.failureKind === 'cancelled') return 'cancelled';

  if (execution.status === 'blocked') return 'unavailable';

  if (execution.outcome === 'failure')
    return execution.failureKind === 'unsupported' ? 'unsupported' : 'failed';

  if (execution.configurationWaitReason) return 'waiting';

  // A successful execution alone does not establish that the current source was published.
  if (execution.status === 'completed') return 'unavailable';

  return execution.status;
}

type JobInput = {
  processing?: Processing;
  execution?: Execution;
  capability?: Capability;
  pending: boolean;
  unavailable: boolean;
};

function requestStatus({
  processing,
  execution,
  capability,
  pending,
  unavailable
}: JobInput): Status {
  if (isPublished(processing)) return 'complete';

  if (unavailable) return 'unavailable';

  if (execution) return executionStatus(execution);

  if (pending) return 'loading';

  if (processing?.requestedAtMs != null) return 'queued';

  if (capability?.reason === 'no_decoder') return 'unsupported';

  return 'idle';
}

function isExtractionRetryable(kind: Execution['failureKind']) {
  return kind !== null && (kind === 'internal' || isRetryable(kind));
}

function retryRevision(status: Status, { processing, execution, capability }: JobInput) {
  // Retrying ingestion would discard the original operation for a failed correction.
  if (!processing || execution?.workflow !== 'source-ingestion/v1') return;

  if (status === 'cancelled') return processing.revision;

  if (status === 'unsupported' && capability?.status === 'supported') return processing.revision;

  if (status === 'failed' && isExtractionRetryable(execution.failureKind))
    return processing.revision;
}

function summaryLabel(status: Status, execution?: Execution): StaticMessageKey {
  const wait = execution?.configurationWaitReason;

  if (status === 'waiting' && wait) return waitLabels[wait];

  if (status === 'unsupported' && !execution) return 'MaterialExtractionNoDecoder';

  if (status === 'running' && execution?.workflow === 'source-correction/v1')
    return 'MaterialCorrectionRunning';

  return statusLabels[status];
}

function lastUpdate(status: Status, { execution, processing }: JobInput) {
  if (execution) return Number(execution.updatedAtMs);

  if (status === 'queued') return processing?.requestedAtMs ?? undefined;
}

export function describeExtractionJob(input: JobInput): ExtractionJob {
  const { processing, execution } = input;
  const status = requestStatus(input);

  return {
    status,
    summary: summaryLabel(status, execution),
    sidebar: sidebarLabels[status] ?? statusLabels[status],
    retained: !!processing?.documentId && status !== 'complete',
    retryRevision: retryRevision(status, input),
    runningExecutionId: status === 'running' ? execution?.id : undefined,
    updatedAtMs: lastUpdate(status, input)
  };
}
