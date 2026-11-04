import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { queryOptions, mutationOptions } from '@tanstack/react-query';

import {
  captureContext,
  transformDocument,
  cancelGeneration,
  retryGeneration
} from './session-workspace.queries';
import type { TransformInput } from './session-workspace.queries';

export type Attempt = {
  key: string;
  additionalSessionIds?: readonly SessionId[];
  revision: bigint;
  title: string;
  instruction: string;
  operations: TransformInput['operations'];
  language: 'english' | 'italian';
};

export type TransformDraft = {
  title: string;
  instruction: string;
  operations: TransformInput['operations'];
  attempt?: Attempt;
  pending?: boolean;
  unavailable?: boolean;
  requestId?: string;
  contextId?: string;
  retryId?: string;
  runs?: { id: string; contextId: string }[];
};

export function transformDraftOptions(
  id: SessionId,
  additionalSessionIds: readonly SessionId[] = []
) {
  const initial: TransformDraft = { title: '', instruction: '', operations: ['clarity'] };

  return queryOptions({
    queryKey: [
      'session-drafts',
      String(id),
      'transform',
      ...(additionalSessionIds.length
        ? [[...new Set(additionalSessionIds)].map(String).toSorted().join(',')]
        : [])
    ],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
}

export function transformAttemptOptions(
  id: SessionId,
  captured: (contextId: string) => void,
  received: (result: Awaited<ReturnType<typeof transformDocument>>, contextId: string) => void
) {
  return mutationOptions({
    mutationFn: async (attempt: Attempt) => {
      const context = await captureContext({
        sessionId: id,
        additionalSessionIds: attempt.additionalSessionIds?.length
          ? attempt.additionalSessionIds
          : undefined,
        intentKey: attempt.key,
        instruction: attempt.instruction,
        preferences: { language: attempt.language }
      });

      if (context.selectionRevision !== attempt.revision)
        throw new StudyError('invalid_input', 'Selection changed before capture');

      captured(context.requestId);
      const result = await transformDocument({
        contextRequestId: context.requestId,
        operations: attempt.operations,
        title: attempt.title
      });

      received(result, context.requestId);

      return result;
    }
  });
}

export function transformRetryOptions(requestId: string) {
  return queryOptions({
    queryKey: ['session-drafts', 'transform-retry', requestId],
    queryFn: () => null as { key: string; acknowledged: boolean } | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
}

export function cancelTransformOptions(requestId: string) {
  return mutationOptions({ mutationFn: () => cancelGeneration(requestId), retry: false });
}

export function retryTransformOptions(requestId: string) {
  return mutationOptions({
    mutationFn: (key: string) => retryGeneration(requestId, key),
    retry: false
  });
}
