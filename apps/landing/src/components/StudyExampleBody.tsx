import { landingCopy } from '@study/localization';
import { useSyncExternalStore } from 'react';

import { NoteExample, AnswerExample, PageExample } from './StudyDocumentExamples';
import { StudyFlashcardExample } from './StudyFlashcardExample';
import { StudyQuizExample } from './StudyQuizExample';

export type ExampleKind = 'note' | 'answer' | 'page' | 'flashcards' | 'quiz';

export interface StudyExampleProps {
  lang: 'en' | 'it';
  kind: ExampleKind;
  phase?: 'start' | 'result';
}

const subscribe = () => () => {};

const clientSnapshot = () => true;

const serverSnapshot = () => false;

const examples = {
  note: NoteExample,
  answer: AnswerExample,
  page: PageExample
};

/** Local, authored examples use the app's presentation primitives without its account or RPC services. */
export function StudyExampleBody({ lang, kind, phase }: StudyExampleProps) {
  const c = landingCopy[lang].examples;
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const Example =
    kind === 'note' || kind === 'answer' || kind === 'page' ? examples[kind] : examples.page;

  return (
    <div className="study-example" data-kind={kind}>
      <div className="example-body">
        {kind === 'quiz' ? (
          <StudyQuizExample lang={lang} ready={ready} phase={phase} />
        ) : kind === 'flashcards' ? (
          <StudyFlashcardExample lang={lang} ready={ready} phase={phase} />
        ) : (
          <Example lang={lang} ready={ready} phase={phase} />
        )}
      </div>
      <p className="example-disclosure">{c.label}</p>
    </div>
  );
}
