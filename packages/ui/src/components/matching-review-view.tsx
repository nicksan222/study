import { Practice } from '#ui/components/practice.tsx';

import { usePracticePresentation } from './practice-presentation';
import type { PracticeResultQuestionModel } from './practice-question-model';

type Question = Extract<PracticeResultQuestionModel, { kind: 'matching' }>;

/** Compare each saved association with its correct definition using labeled result text. */
export function MatchingReviewView({ question }: { question: Question }) {
  const { t } = usePracticePresentation();

  return (
    <div>
      {question.terms.map((term) => {
        const selected = question.answer?.associations.find((a) => a.termId === term.id);
        const correct = question.pairs.find((p) => p.termId === term.id);
        const text = (id: string | undefined) =>
          question.definitions.find((d) => d.id === id)?.text;

        return (
          <Practice.MatchingRow key={term.id}>
            <span>{term.text}</span>
            <Practice.MatchingReview>
              <Practice.ResultVerdict
                tone={
                  correct?.score === 1 ? 'correct' : question.answer ? 'incorrect' : 'unanswered'
                }
              >
                {t(
                  correct?.score === 1
                    ? 'VerdictCorrect'
                    : question.answer
                      ? 'VerdictIncorrect'
                      : 'PracticeUnanswered'
                )}
              </Practice.ResultVerdict>
              <p>
                <Practice.MutedText>{t('YourAnswer')}: </Practice.MutedText>
                {text(selected?.definitionId) ?? t('PracticeUnanswered')}
              </p>
              <p>
                <Practice.MutedText>{t('RightAnswer')}: </Practice.MutedText>
                {text(correct?.definitionId)}
              </p>
            </Practice.MatchingReview>
          </Practice.MatchingRow>
        );
      })}
    </div>
  );
}
