import type { quizAttemptCompletedSchema } from '@study/contracts';
import { RetryIcon } from '@study/icons';
import { Button, QuizResultsView } from '@study/ui';
import { Link, useSearch } from '@tanstack/react-router';

import { useI18n } from '#client/lib/i18n.tsx';

import { ClientPracticePresentation } from './presentation';

export function QuizResults({
  attempt,
  presentation = 'page'
}: {
  attempt: typeof quizAttemptCompletedSchema.Type;
  presentation?: 'page' | 'preview';
}) {
  const search = useSearch({ from: '__root__' });
  const { t } = useI18n();

  return (
    <ClientPracticePresentation>
      <QuizResultsView
        attempt={attempt}
        presentation={presentation}
        retry={
          <Button
            render={
              <Link
                to="/practice/$materialId"
                params={{ materialId: String(attempt.materialId) }}
                search={{ project: search.project }}
              />
            }
          >
            <RetryIcon aria-hidden="true" />
            {t('PracticeTryAgain')}
          </Button>
        }
      />
    </ClientPracticePresentation>
  );
}
