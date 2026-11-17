import type { quizAnswerSchema, quizAttemptInProgressSchema } from '@study/contracts';
import { quizAnswerSchema as answerSchema } from '@study/contracts';
import { QuizQuestionView } from '@study/ui';
import { Schema } from 'effect';
import type { ComponentProps, ReactNode } from 'react';

import { DictationTextarea } from '#client/features/voice/index.ts';
import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { ClientPracticePresentation } from './presentation';

export function QuizQuestion(props: {
  question: (typeof quizAttemptInProgressSchema.Type)['questions'][number];
  pending: boolean;
  response?: ComponentProps<typeof QuizQuestionView>['response'];
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
        renderOpenAnswer={({ text, setText, send, disabled, label, placeholder }) => (
          <DictationTextarea
            targetKey={props.question.id}
            aria-label={label}
            value={text}
            onValueChange={setText}
            disabled={disabled}
            placeholder={placeholder}
            maxLength={100000}
            onKeyDown={(event) => {
              if (
                !event.nativeEvent.isComposing &&
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                send();
              }
            }}
          />
        )}
        blocked={needsAi && readiness !== 'ready'}
        notice={needsAi ? <AiReadinessNotice state={readiness} /> : undefined}
        submit={(answer) => props.submit(Schema.decodeUnknownSync(answerSchema)(answer))}
      />
    </ClientPracticePresentation>
  );
}
