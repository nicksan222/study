import { quizAnswerSchema } from '@study/contracts/learning/schemas';
import { createLocalization } from '@study/localization';
import { landingCopy } from '@study/localization/landing';
import { Button } from '@study/ui/button';
import { QuizQuestionView } from '@study/ui/quiz-question-view';
import { QuizResultsView } from '@study/ui/quiz-results-view';
import { QuizSessionView } from '@study/ui/quiz-session-view';
import { SelectControl } from '@study/ui/select-control';
import { Schema } from 'effect';
import { useState } from 'react';

import { kinds, sample, sampleResult } from './practice-samples';
import { PracticeExamplePresentation } from './PracticeExamplePresentation';

type Lang = 'en' | 'it';

type Answer = typeof quizAnswerSchema.Type;

/** Authored sample data and local callbacks drive the same question and results views as the app. */
export function StudyQuizExample({
  lang,
  ready,
  phase
}: {
  lang: Lang;
  ready: boolean;
  phase?: 'start' | 'result';
}) {
  const c = landingCopy[lang];
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [kind, setKind] = useState<(typeof kinds)[number]>('single_choice');
  const [answer, setAnswer] = useState<Answer | null>(
    phase === 'result'
      ? Schema.decodeUnknownSync(quizAnswerSchema)({ type: 'choice', choiceIds: [2n] })
      : null
  );
  const [round, setRound] = useState(0);
  const attempt = sample(lang, kind);
  const question = attempt.questions[0]!;
  const reset = () => {
    setAnswer(null);
    setRound((value) => value + 1);
  };
  const completed = answer ? sampleResult(attempt, answer, c) : undefined;

  return (
    <PracticeExamplePresentation lang={lang}>
      <SelectControl
        label={c.quizExample.format}
        value={kind}
        disabled={!ready}
        options={kinds.map((value, index) => ({ value, label: c.quizExample.kinds[index]! }))}
        onValueChange={(value) => {
          const selected = kinds.find((item) => item === value);

          if (selected) {
            setKind(selected);
            reset();
          }
        }}
      />
      {completed ? (
        <QuizResultsView
          attempt={completed}
          retry={<Button onClick={reset}>{t('PracticeTryAgain')}</Button>}
        />
      ) : (
        <QuizSessionView label={t('PracticeQuizOverview')} answered={0} total={1}>
          <QuizQuestionView
            key={`${kind}-${round}`}
            question={question}
            autoFocus={false}
            pending={!ready}
            last
            submit={(value) => setAnswer(Schema.decodeUnknownSync(quizAnswerSchema)(value))}
          />
        </QuizSessionView>
      )}
    </PracticeExamplePresentation>
  );
}
