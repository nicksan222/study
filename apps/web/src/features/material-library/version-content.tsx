import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { MaterialLibrary } from '@study/ui/material-library';

import { useI18n } from '#web/lib/i18n.tsx';

export function MaterialVersionContent({ version }: { version: MaterialVersionDetailDto }) {
  const { t } = useI18n();
  const content = version.content;

  if (content.kind === 'diagram')
    return (
      <MaterialLibrary.ProseContent>
        <p>{t('ReaderDiagramSource')}</p>
        <pre>
          <code>{content.payload}</code>
        </pre>
      </MaterialLibrary.ProseContent>
    );

  if (content.kind === 'flashcards')
    return (
      <MaterialLibrary.ProseDetails>
        {content.cards.map((card) => (
          <div key={String(card.cardId)}>
            <dt>{card.front}</dt>
            <dd>{card.back}</dd>
          </div>
        ))}
      </MaterialLibrary.ProseDetails>
    );

  return (
    <MaterialLibrary.ProseList>
      {content.questions.map((question) => (
        <li key={String(question.id)}>
          <p>{question.prompt}</p>
          {question.kind === 'open' ? (
            <p>{question.referenceAnswer}</p>
          ) : (
            <ul>
              {question.choices.map((choice) => (
                <li key={String(choice.id)}>
                  {choice.text}
                  {choice.isCorrect && <span> · {t('ReaderCorrectAnswer')}</span>}
                </li>
              ))}
            </ul>
          )}
          <p>{question.explanation}</p>
        </li>
      ))}
    </MaterialLibrary.ProseList>
  );
}
