import { StudyError } from '@study/contracts/errors';
import type { DocumentId, MaterialId, MaterialVersionId } from '@study/contracts/ids';
import type { Source, blockIdSchema } from '@study/contracts/sources/schemas';
import { infiniteQueryOptions, queryOptions, mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const materialOptions = (id: MaterialId) =>
  queryOptions({
    queryKey: ['materials', 'detail', String(id)],
    queryFn: ({ signal }) => request((client) => client['materials.material']({ id }), signal)
  });

export const historyOptions = (materialId: MaterialId) =>
  infiniteQueryOptions({
    queryKey: ['materials', 'history', String(materialId)],
    initialPageParam: undefined as MaterialVersionId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) =>
          client['materials.materialVersions']({ materialId, cursor: pageParam, limit: 30 }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

export { downloadOriginal } from '#web/lib/study-client/material-original.ts';

export const importMutationKey = ['materials', 'import'] as const;

export type ImportInput = { file: File | null; url: string };

async function importSource({ file, url }: ImportInput): Promise<Source> {
  if (!file)
    return request((client) => client['sources.addLink']({ url: url.trim(), projectId: null }));

  let bytes: Uint8Array;

  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (cause) {
    throw new StudyError('invalid_input', 'Cannot read selected file', { cause });
  }

  return request((client) =>
    client['sources.createSource']({ name: file.name, bytes, projectId: null })
  );
}

export const importMutationOptions = () =>
  mutationOptions({
    mutationKey: importMutationKey,
    mutationFn: importSource,
    retry: false,
    gcTime: Infinity
  });

export {
  materialPage,
  materialsOptions,
  versionOptions
} from '#web/lib/study-client/materials.queries.ts';

export const exactImageOptions = (
  id: MaterialVersionId,
  documentId: DocumentId,
  blockId: typeof blockIdSchema.Type
) =>
  queryOptions({
    queryKey: ['materials', 'image', String(id), String(documentId), blockId],
    queryFn: ({ signal }) =>
      request((rpc) => rpc['materials.materialVersionImage']({ id, documentId, blockId }), signal),
    gcTime: 0,
    retry: false
  });

export const exactDocumentOptions = (id: MaterialVersionId) =>
  queryOptions({
    queryKey: ['materials', 'document', String(id)],
    queryFn: ({ signal }) =>
      request((rpc) => rpc['materials.materialVersionDocument']({ id }), signal)
  });

export const materialSearchOptions = (query: string) =>
  queryOptions({
    queryKey: ['materials', 'search', query],
    enabled: !!query,
    queryFn: ({ signal }) =>
      request((rpc) => rpc['system.materialSearch']({ query, limit: 30 }), signal)
  });
