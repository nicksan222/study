import type { ProjectId } from '@study/contracts/ids';
import type { materialGenerationInputSchema } from '@study/contracts/materials/schemas';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { listPracticeDocuments } from '#web/lib/study-client/practice-documents.ts';
import { request } from '#web/lib/study-client/request.ts';

export const quizGenerationMutationOptions = () =>
  mutationOptions({
    mutationFn: (input: typeof materialGenerationInputSchema.Type) =>
      request((client) => client['materials.requestMaterialGeneration'](input))
  });

export const quizGenerationOptions = (requestId: string) =>
  queryOptions({
    queryKey: ['materials', 'generation', requestId],
    queryFn: ({ signal }) =>
      request((client) => client['materials.materialGeneration']({ requestId }), signal),
    refetchInterval: (query) =>
      query.state.data?.cancelled ||
      query.state.data?.resultVersionId ||
      query.state.data?.errorKind
        ? false
        : 2000
  });

export const generationDocumentsOptions = (projectId?: ProjectId) =>
  queryOptions({
    queryKey: ['documents', 'generation', projectId?.toString()],
    queryFn: ({ signal }) => listPracticeDocuments(projectId, signal)
  });
