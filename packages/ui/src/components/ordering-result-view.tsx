import { Practice } from '#ui/components/practice.tsx';

import { usePracticePresentation } from './practice-presentation';
import type { PracticeResultQuestionModel } from './practice-question-model';

type Question = Extract<PracticeResultQuestionModel, { kind: 'ordering' }>;

/** Presents learner and canonical sequences separately after attempt completion. */
export function OrderingResultView({ question }: { question: Question }) {
  const { t } = usePracticePresentation();
  const sequence = (ids: readonly bigint[], reference = false) =>
    ids.map((id, position) => ({
      tone:
        reference || question.correctItemIds[position] === id
          ? ('correct' as const)
          : ('incorrect' as const),
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
        <Practice.Ordering
          label={t('RightAnswer')}
          items={sequence(question.correctItemIds, true)}
        />
      </div>
    </Practice.OpenAnswers>
  );
}
