import { RegistryContext, useAtom } from '@effect/atom-react';
import type { SourceId, NoteId, ContentSnapshotId, sourceCopySchema, Page } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

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

/** The bounded live workflow view follows the source's current request identity. */
export function useSourceProcessingExecution(id: SourceId) {
  const processing = rpc.sources.sourceProcessing.useQuery({ id });
  const executions = rpc.workflows.executions.useQuery(
    {
      correlationId: processing.data?.requestId ?? undefined,
      workflows: ['source-ingestion/v1', 'source-correction/v1'],
      limit: 1
    },
    { enabled: !!processing.data?.requestId }
  );
  const state = processing.isError || processing.isPending ? processing : executions;

  return {
    ...state,
    data: executions.data?.items.find(
      (item) => item.workflow === 'source-ingestion/v1' || item.workflow === 'source-correction/v1'
    )
  };
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

  return { ...state, copy, acknowledge };
}
