import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { cardCount, questionCount, questionNumber } from '@study/localization';
import { Practice } from '@study/ui/practice';
import { Textarea } from '@study/ui/textarea';

import { useI18n } from '#client/lib/i18n.tsx';

type Quiz = Extract<MaterialVersionDetailDto, { kind: 'quiz' }>;

export function MaterialVersionContent({ version }: { version: MaterialVersionDetailDto }) {
  const { t, locale } = useI18n();

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

/** Render canonical material answers, including term-definition pairs, for version review. */
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
        <span>{t(questionLabel(question.kind))}</span>
      </Practice.ProgressHeading>
      <Practice.Prompt>{question.prompt}</Practice.Prompt>
      <Practice.Answers aria-label={t('RightAnswer')}>
        {question.kind === 'ordering' ? (
          <Practice.Ordering
            label={t('RightAnswer')}
            items={question.items.map((item) => ({ key: String(item.id), text: item.text }))}
          />
        ) : question.kind === 'matching' ? (
          question.pairs.map((pair) => (
            <Practice.MatchingRow key={pair.termId}>
              <span>{pair.term}</span>
              <p>{pair.definition}</p>
            </Practice.MatchingRow>
          ))
        ) : !('choices' in question) ? (
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

/** Name every persisted question variant in material previews. */
function questionLabel(kind: Quiz['content']['questions'][number]['kind']) {
  const labels = {
    ordering: 'PracticeOrdering',
    matching: 'PracticeMatching',
    true_false: 'PracticeTrueFalse',
    fill_blank: 'PracticeFillBlank',
    open: 'QuestionOpen',
    single_choice: 'QuestionChoice',
    multiple_choice: 'QuestionChoice'
  } as const;

  return labels[kind];
}
