import { StudyError } from '@study/contracts/errors';
import type { selectionReferenceSchema } from '@study/contracts/notes/context';
import { rpc } from '@study/contracts/react';

type Selection = typeof selectionReferenceSchema.Type;

type Extraction = ReturnType<typeof rpc.sources.extraction.useQuery>['data'];

type Version = ReturnType<typeof rpc.pages.version.useQuery>['data'];

type Owner = ReturnType<typeof rpc.pages.get.useQuery>['data'];

function selectedSource(input: Extract<Selection, { kind: 'source' }>, source: Extraction) {
  if (!source) return undefined;

  if (
    source.sourceId !== input.sourceId ||
    source.revision !== input.revision ||
    source.snapshotId !== input.snapshotId
  )
    return undefined;

  return { ...source, pageId: null, number: undefined };
}

function selectedPage(input: Extract<Selection, { kind: 'page' }>, version: Version, owner: Owner) {
  if (!version || !owner) return undefined;

  if (
    version.status !== 'published' ||
    version.id !== input.versionId ||
    owner.id !== version.pageId
  )
    return undefined;

  return { ...version, name: owner.title };
}

/** Exact selection identity stays reactive to retirement and owner changes. */
export function useSelectedContent(input: Selection) {
  const source = rpc.sources.extraction.useQuery(input.kind === 'source' ? input : undefined);
  const version = rpc.pages.version.useQuery(
    input.kind === 'page' ? { id: input.versionId } : undefined
  );
  const owner = rpc.pages.get.useQuery(version.data ? { id: version.data.pageId } : undefined);
  const current = input.kind === 'source' ? source : version.isSuccess ? owner : version;
  const exact =
    input.kind === 'source'
      ? selectedSource(input, source.data)
      : selectedPage(input, version.data, owner.data);
  const error =
    current.isSuccess && !exact
      ? new StudyError('invalid_input', 'Selected content identity mismatch')
      : current.error;

  return {
    data: exact,
    error,
    isPending: current.isPending,
    isError: !!error,
    refetch: () => {
      source.refetch();
      version.refetch();
      owner.refetch();
    }
  };
}
