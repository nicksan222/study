import { StudyError } from '@study/contracts/errors';
import type {
  ProjectId,
  MaterialId,
  QuizAttemptId,
  MaterialVersionId,
  MaterialCardId
} from '@study/contracts/ids';
import type { answerQuestionInputSchema } from '@study/contracts/learning/rpc';
import type { learningRatingSchema } from '@study/contracts/learning/schemas';
import type { QuizSettings } from '@study/contracts/settings/types';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';

import { listDueCards } from '#web/lib/study-client/learning.ts';
import { request } from '#web/lib/study-client/request.ts';

export const attemptsOptions = (materialId: MaterialId) =>
  infiniteQueryOptions({
    queryKey: ['learning', 'attempts', String(materialId)],
    initialPageParam: undefined as QuizAttemptId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) => client['learning.attempts']({ materialId, limit: 20, cursor: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

export const attemptOptions = (id: QuizAttemptId) =>
  queryOptions({
    queryKey: ['learning', 'attempt', String(id)],
    queryFn: ({ signal }) =>
      request((client) => client['learning.attempt']({ attemptId: id }), signal),
    refetchInterval: (query) => {
      const data = query.state.data;

      return data?.status === 'completed' &&
        data.questions.some((question) => question.grading === 'ungraded')
        ? 3000
        : false;
    }
  });

export const startQuizOptions = (versionId: MaterialVersionId, configuration?: QuizSettings) => ({
  mutationFn: () => request((rpc) => rpc['learning.startQuiz']({ versionId, configuration }))
});

export const answerOptions = (slotId?: string) => ({
  mutationFn: (input: typeof answerQuestionInputSchema.Type) =>
    request((rpc) =>
      slotId
        ? rpc['learning.answerPracticeQuestion']({ slotId, answer: input.answer })
        : rpc['learning.answerQuestion'](input)
    )
});

export const finishQuizOptions = (attemptId: QuizAttemptId) => ({
  mutationFn: () => request((rpc) => rpc['learning.finishQuiz']({ attemptId }))
});

export const reviewCardOptions = (
  versionId: MaterialVersionId,
  cardId: MaterialCardId | undefined
) => ({
  mutationFn: (rating: typeof learningRatingSchema.Type) => {
    if (cardId === undefined) throw new StudyError('invalid_input', 'No card selected');

    return request((rpc) => rpc['learning.reviewCard']({ versionId, cardId, rating }));
  }
});

export const dueCardsOptions = (projectId: ProjectId) =>
  queryOptions({
    queryKey: ['learning', 'due', String(projectId)],
    queryFn: ({ signal }) => listDueCards(projectId, signal)
  });

export const archivedMaterialsOptions = (projectId?: ProjectId) =>
  infiniteQueryOptions({
    queryKey: ['materials', 'archived', projectId?.toString()],
    initialPageParam: undefined as MaterialId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) =>
          rpc['materials.materials']({ projectId, archived: true, cursor: pageParam, limit: 30 }),
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });

export function useMaterialArchive(id: MaterialId, archived: boolean) {
  const cache = useQueryClient();

  return useMutation({
    mutationKey: ['materials', 'archive', String(id)],
    mutationFn: () =>
      request((rpc) =>
        archived ? rpc['materials.unarchive']({ id }) : rpc['materials.archive']({ id })
      ),
    onSuccess: (material) => {
      cache.setQueryData(['materials', 'detail', String(id)], material);
      void cache.invalidateQueries({ queryKey: ['materials'] });
      void cache.invalidateQueries({ queryKey: ['library'] });
      void cache.invalidateQueries({ queryKey: ['search'] });
      void cache.invalidateQueries({ queryKey: ['learning', 'due'] });
    }
  });
}
