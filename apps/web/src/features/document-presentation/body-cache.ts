import { comparisonSchema } from '@study/contracts/documents/editing';
import { detailSchema } from '@study/contracts/documents/schemas';
import { exactExtractionSchema } from '@study/contracts/sources/rpc';
import type { Query, QueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';

type DocumentOwner = { kind: 'document'; documentId: string; versionIds: readonly string[] };
type SourceOwner = { kind: 'source'; sourceId: string; snapshotIds: readonly string[] };

const isComparison = Schema.is(comparisonSchema);
const isExtraction = Schema.is(exactExtractionSchema);
const isSourceCopy = Schema.is(Schema.Struct({ document: detailSchema }));

function comparisonBody(data: unknown, owner: DocumentOwner, ids: Set<string>) {
  return (
    isComparison(data) &&
    [data.before, data.proposed, data.current].some(
      (version) => String(version.documentId) === owner.documentId && ids.has(String(version.id))
    )
  );
}

function retainedRangeBody(value: unknown, owner: DocumentOwner, ids: Set<string>) {
  const [documentId, versionId] = String(value).split(':');
  return documentId === owner.documentId && versionId !== undefined && ids.has(versionId);
}

function currentExtractionBody(data: unknown, owner: SourceOwner, ids: Set<string>) {
  return (
    isExtraction(data) &&
    String(data.sourceId) === owner.sourceId &&
    ids.has(String(data.snapshotId))
  );
}

function documentBody(
  key: readonly unknown[],
  data: unknown,
  owner: DocumentOwner,
  ids: Set<string>
) {
  if (key[0] !== 'documents') return false;
  if (key[1] === 'proposal-comparison') return comparisonBody(data, owner, ids);
  if (['version', 'evidence', 'assessments'].includes(String(key[1])))
    return ids.has(String(key[2]));
  if (key[1] === 'annotationDocument')
    return key[2] === owner.documentId && ids.has(String(key[3]));
  if (key[1] === 'retainedRange') return retainedRangeBody(key[2], owner, ids);
  if (key[1] === 'selected-input') return [...ids].some((id) => key[2] === `document:${id}`);
  return (
    ['history', 'annotationVersions', 'detail'].includes(String(key[1])) &&
    key[2] === owner.documentId
  );
}
function sourceBody(key: readonly unknown[], data: unknown, owner: SourceOwner, ids: Set<string>) {
  if (key[0] !== 'sources') return false;
  if (key[1] === 'current-extraction')
    return key[2] === owner.sourceId && currentExtractionBody(data, owner, ids);
  if (key[1] === 'image') return ids.has(String(key[2]));
  if (key[1] === 'selected-input') {
    const [, sourceId, , snapshotId] = String(key[2]).split(':');
    return sourceId === owner.sourceId && snapshotId !== undefined && ids.has(snapshotId);
  }
  return key[1] === 'extraction' && key[2] === owner.sourceId && ids.has(String(key[4]));
}
/** Release exact body previews, including inactive derived reads; notes and drafts are separate. */
export async function releaseBodyPreviews(cache: QueryClient, owner: DocumentOwner | SourceOwner) {
  const ids = new Set(owner.kind === 'document' ? owner.versionIds : owner.snapshotIds);
  const owned = {
    predicate: ({
      queryKey,
      state
    }: {
      queryKey: readonly unknown[];
      state: { data: unknown };
    }) => {
      if (owner.kind === 'source') return sourceBody(queryKey, state.data, owner, ids);
      if (queryKey[0] === 'source-copy') {
        return (
          isSourceCopy(state.data) &&
          String(state.data.document.id) === owner.documentId &&
          ids.has(String(state.data.document.version?.id))
        );
      }
      return documentBody(queryKey, state.data, owner, ids);
    }
  };
  // Capture identities before resetting: clearing data must not change which entries
  // are released, and a newly reconciled current snapshot must remain cached.
  const matches = new Set(cache.getQueryCache().findAll(owned));
  const selected = { predicate: (query: Query) => matches.has(query) };
  await cache.cancelQueries(selected);
  cache.removeQueries({ predicate: (query) => matches.has(query) && !query.isActive() });
  await cache.resetQueries(selected);
  // Search results contain body excerpts and have no stable per-result query identity.
  for (const queryKey of [['search'], ['session-material-search']]) {
    await cache.cancelQueries({ queryKey });
    await cache.resetQueries({ queryKey });
    cache.removeQueries({ queryKey });
  }
}
