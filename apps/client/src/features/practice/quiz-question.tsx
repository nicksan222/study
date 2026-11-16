import type {
  quizAnswerSchema,
  quizAttemptInProgressSchema
} from '@study/contracts/learning/schemas';
import { quizAnswerSchema as answerSchema } from '@study/contracts/learning/schemas';
import { QuizQuestionView } from '@study/ui/quiz-question-view';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { ClientPracticePresentation } from './presentation';

export function QuizQuestion(props: {
  question: (typeof quizAttemptInProgressSchema.Type)['questions'][number];
  pending: boolean;
  submit: (answer: typeof quizAnswerSchema.Type) => void;
  last: boolean;
  previous?: () => void;
  review?: () => void;
  error?: ReactNode;
}) {
  const readiness = useAiReadiness('medium');
  const needsAi = props.question.kind === 'open' || props.question.kind === 'fill_blank';

  return (
    <ClientPracticePresentation>
      <QuizQuestionView
        {...props}
        blocked={needsAi && readiness !== 'ready'}
        notice={needsAi ? <AiReadinessNotice state={readiness} /> : undefined}
        submit={(answer) => props.submit(Schema.decodeUnknownSync(answerSchema)(answer))}
      />
    </ClientPracticePresentation>
  );
}
