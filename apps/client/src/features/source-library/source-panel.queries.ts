import { RegistryContext, useAtom } from '@effect/atom-react';
import type {
  SourceId,
  NoteId,
  ContentSnapshotId,
  sourceCopySchema,
  Page,
  Source
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { describeExtractionJob, isPublished } from './extraction-job';

/** Current and pinned extraction reads never borrow another revision's body. */
export function useSourceExtraction(
  id: SourceId,
  exact?: { revision: bigint; snapshotId: ContentSnapshotId },
  enabled = true
) {
  const current = rpc.sources.currentExtraction.useQuery({ id }, { enabled: enabled && !exact });
  const pinned = rpc.sources.extraction.useQuery(exact ? { sourceId: id, ...exact } : undefined, {
    enabled
  });

  return exact ? pinned : current;
}

const extractionWorkflows = ['source-ingestion/v1', 'source-correction/v1'];

/** The bounded live workflow view follows the source's current request identity. */
export function useSourceProcessingExecution(id: SourceId, enabled = true) {
  const processing = rpc.sources.sourceProcessing.useQuery({ id }, { enabled });
  const correlationId = processing.data?.requestId ?? undefined;
  const executions = rpc.workflows.executions.useQuery(
    { correlationId, workflows: extractionWorkflows, limit: 1 },
    { enabled: enabled && correlationId !== undefined }
  );

  return {
    processing: processing.data,
    isPending: processing.isPending || (correlationId !== undefined && executions.isPending),
    isError: processing.isError || (correlationId !== undefined && executions.isError),
    data: executions.data?.items.find(
      (item) => item.correlationId === correlationId && extractionWorkflows.includes(item.workflow)
    )
  };
}

type ProcessingExecution = ReturnType<typeof useSourceProcessingExecution>;

function capabilityReason(state: ProcessingExecution) {
  if (isPublished(state.processing)) return;

  if (state.data?.failureKind === 'unsupported') return 'retry';

  if (!state.data && !state.isPending && !state.isError && state.processing?.requestedAtMs == null)
    return 'classify';
}

function useExtractionCapability(
  source: Source | undefined,
  state: ProcessingExecution,
  enabled: boolean
) {
  const reason = enabled && source && source.kind !== 'link' ? capabilityReason(state) : undefined;
  const capability = rpc.sources.importCapability.useQuery(
    source ? { kind: source.kind, mime: source.mime } : undefined,
    { enabled: reason !== undefined }
  );

  return {
    capability: reason ? capability.data : undefined,
    pending: reason === 'classify' && capability.isPending,
    unavailable: reason === 'classify' && capability.isError
  };
}

export function useExtractionJob(id: SourceId, source?: Source, enabled = true) {
  const state = useSourceProcessingExecution(id, enabled);
  const capability = useExtractionCapability(source, state, enabled);

  return describeExtractionJob({
    processing: state.processing,
    execution: state.data,
    capability: capability.capability,
    pending: state.isPending || capability.pending,
    unavailable: state.isError || capability.unavailable
  });
}

type Input = typeof sourceCopySchema.Type;

type CopyState = { pending: boolean; input?: Input; page?: Page; error?: unknown };

const copies = Atom.family((_key: string) =>
  Atom.make<CopyState>({ pending: false }).pipe(Atom.keepAlive)
);

/** An immutable draft request survives reconnects until its receipt is acknowledged. */
export function useSourceCopy(sourceId: SourceId, noteId?: NoteId) {
  const atom = copies(`${sourceId}:${noteId ?? ''}`);
  const registry = useContext(RegistryContext);
  const [state, setState] = useAtom(atom);

  async function copy(extraction: {
    revision: bigint;
    snapshotId: Input['snapshotId'];
    name: string;
  }) {
    const current = registry.get(atom);

    if (current.pending) return;

    if (current.page) return current.page;

    const input = current.input ?? {
      sourceId,
      noteId,
      createKey: crypto.randomUUID(),
      title: extraction.name,
      revision: extraction.revision,
      snapshotId: extraction.snapshotId
    };

    setState({ pending: true, input });

    try {
      const page = await rpc.pages.copySource.call(input);

      setState({ pending: false, input, page });

      return page;
    } catch (error) {
      setState({ pending: false, input, error });

      return;
    }
  }

  function acknowledge() {
    const current = registry.get(atom);

    if (current.page && !current.pending) setState({ pending: false });
  }

  async function open(
    extraction: Parameters<typeof copy>[0] | null | undefined,
    onOpen: (page: Page) => void
  ) {
    if (!extraction) return;

    const page = await copy(extraction);

    if (page) onOpen(page);
  }

  return { ...state, copy, open, acknowledge };
}
