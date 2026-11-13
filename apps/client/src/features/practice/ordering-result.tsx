import type { quizAttemptCompletedSchema } from '@study/contracts/learning/schemas';
import { Practice } from '@study/ui/practice';

import { useI18n } from '#client/lib/i18n.tsx';

type Question = Extract<
  (typeof quizAttemptCompletedSchema.Type)['questions'][number],
  { kind: 'ordering' }
>;

/** Presents learner and canonical sequences separately after attempt completion. */
export function OrderingResult({ question }: { question: Question }) {
  const { t } = useI18n();
  const sequence = (ids: readonly bigint[]) =>
    ids.map((id) => ({
      key: String(id),
      text: question.items.find((item) => item.id === id)!.text
    }));

  return (
    <Practice.OpenAnswers>
      <div>
        <Practice.Muted>{t('YourAnswer')}</Practice.Muted>
        {question.answer ? (
          <Practice.Ordering label={t('YourAnswer')} items={sequence(question.answer.itemIds)} />
        ) : (
          <Practice.Muted>{t('PracticeUnanswered')}</Practice.Muted>
        )}
      </div>
      <div>
        <Practice.Muted>{t('RightAnswer')}</Practice.Muted>
        <Practice.Ordering label={t('RightAnswer')} items={sequence(question.correctItemIds)} />
      </div>
    </Practice.OpenAnswers>
  );
}
