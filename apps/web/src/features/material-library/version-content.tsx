import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { cardCount, questionCount, questionNumber } from '@study/localization';
import { MaterialLibrary } from '@study/ui/material-library';
import { Practice } from '@study/ui/practice';
import { Textarea } from '@study/ui/textarea';

import { useI18n } from '#web/lib/i18n.tsx';

type Quiz = Extract<MaterialVersionDetailDto, { kind: 'quiz' }>;

export function MaterialVersionContent({ version }: { version: MaterialVersionDetailDto }) {
  const { t, locale } = useI18n();

  if (version.kind === 'diagram')
    return (
      <MaterialLibrary.ProseContent>
        <p>{t('ReaderDiagramSource')}</p>
        <pre>
          <code>{version.content.payload}</code>
        </pre>
      </MaterialLibrary.ProseContent>
    );

  return (
    <Practice.Preview aria-label={t('PracticeMaterialPreview')}>
      <Practice.ProgressHeading>
        <span>{t(version.kind === 'quiz' ? 'SidebarQuiz' : 'Flashcards')}</span>
        <span>
          {version.kind === 'quiz'
            ? questionCount(locale, version.content.questions.length)
            : cardCount(locale, version.content.cards.length)}
        </span>
      </Practice.ProgressHeading>
      {version.kind === 'quiz' ? (
        <Practice.PreviewItems>
          {version.content.questions.map((question, index) => (
            <QuestionPreview key={String(question.id)} question={question} index={index} />
          ))}
        </Practice.PreviewItems>
      ) : (
        <Practice.PreviewItems>
          {version.content.cards.map((card) => (
            <Practice.PreviewItem key={String(card.cardId)}>
              <Practice.Flashcard>
                <Practice.MutedText>{t('CardFront')}</Practice.MutedText>
                <h2>{card.front}</h2>
                <Practice.CardAnswer>
                  <Practice.MutedText>{t('CardBack')}</Practice.MutedText>
                  <p>{card.back}</p>
                </Practice.CardAnswer>
              </Practice.Flashcard>
            </Practice.PreviewItem>
          ))}
        </Practice.PreviewItems>
      )}
    </Practice.Preview>
  );
}

function QuestionPreview({
  question,
  index
}: {
  question: Quiz['content']['questions'][number];
  index: number;
}) {
  const { t, locale } = useI18n();

  return (
    <Practice.PreviewItem>
      <Practice.ProgressHeading>
        <span>{questionNumber(locale, index + 1)}</span>
        <span>
          {t(
            question.kind === 'true_false'
              ? 'PracticeTrueFalse'
              : question.kind === 'fill_blank'
                ? 'PracticeFillBlank'
                : question.kind === 'open'
                  ? 'QuestionOpen'
                  : 'QuestionChoice'
          )}
        </span>
      </Practice.ProgressHeading>
      <Practice.Prompt>{question.prompt}</Practice.Prompt>
      <Practice.Answers aria-label={t('RightAnswer')}>
        {!('choices' in question) ? (
          <Textarea readOnly aria-label={t('RightAnswer')} value={question.referenceAnswer} />
        ) : (
          question.choices.map((choice, position) => (
            <Practice.ChoiceOption
              key={String(choice.id)}
              text={
                question.kind === 'true_false'
                  ? t(choice.text === 'true' ? 'PracticeTrue' : 'PracticeFalse')
                  : choice.text
              }
              number={position + 1}
              selected={choice.isCorrect}
              type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
              name={'preview-' + String(question.id)}
              value={String(choice.id)}
              disabled
              readOnly
              aria-label={
                (question.kind === 'true_false'
                  ? t(choice.text === 'true' ? 'PracticeTrue' : 'PracticeFalse')
                  : choice.text) +
                '. ' +
                t(choice.isCorrect ? 'ReaderCorrectAnswer' : 'PracticeArchiveOtherOption')
              }
              status={choice.isCorrect ? t('ReaderCorrectAnswer') : undefined}
            />
          ))
        )}
      </Practice.Answers>
      <Practice.Explanation>
        <Practice.MutedText>{t('PracticeArchiveExplanation')}</Practice.MutedText>
        <p>{question.explanation}</p>
      </Practice.Explanation>
    </Practice.PreviewItem>
  );
}
