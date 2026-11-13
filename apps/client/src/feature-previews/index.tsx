import { quizAttemptInProgressSchema } from '@study/contracts/learning/schemas';
import { materialVersionDetailSchema } from '@study/contracts/materials/schemas';
import { documentSchema } from '@study/contracts/sources/schemas';
import type { Locale } from '@study/localization';
import { Schema } from 'effect';

import { DocumentReader } from '../features/document-presentation/document-reader';
import { MaterialVersionContent } from '../features/material-library/version-content';
import { QuizQuestion } from '../features/practice/quiz-question';
import { LanguageProvider } from '../lib/i18n';
import type { PreviewFeature } from './catalog';

export { previewFeatures } from './catalog';
export type { PreviewFeature } from './catalog';

/** Localized sample content is supplied by the host; application components own presentation. */
export interface FeaturePreviewFixture {
  title: string;
  intro: string;
  heading: string;
  paragraph: string;
  transcript: readonly string[];
  question: string;
  choices: readonly string[];
  cardFront: string;
  cardBack: string;
}

/** Static, read-only website previews use the same feature renderers as the application. */
export function FeaturePreview({
  feature,
  locale,
  fixture
}: {
  feature: PreviewFeature;
  locale: Locale;
  fixture: FeaturePreviewFixture;
}) {
  return (
    <LanguageProvider locale={locale}>
      <PreviewContent feature={feature} fixture={fixture} />
    </LanguageProvider>
  );
}

function PreviewContent({
  feature,
  fixture
}: {
  feature: PreviewFeature;
  fixture: FeaturePreviewFixture;
}) {
  if (feature === 'quiz') {
    const attempt = Schema.decodeUnknownSync(quizAttemptInProgressSchema)({
      id: 1n,
      versionId: 2n,
      materialId: 3n,
      startedAt: 1n,
      status: 'in_progress',
      questions: [
        {
          id: 4n,
          position: 0n,
          kind: 'single_choice',
          prompt: fixture.question,
          answer: null,
          choices: fixture.choices.map((text, index) => ({
            id: BigInt(index + 5),
            position: BigInt(index),
            text
          }))
        }
      ]
    });

    return <QuizQuestion question={attempt.questions[0]!} pending={false} submit={() => {}} last />;
  }

  if (feature === 'flashcards') {
    const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
      id: 2n,
      material_id: 3n,
      number: 1n,
      operation: 'original',
      creator: 'user',
      instruction: null,
      language: null,
      created_at: 1n,
      inputs: [],
      parents: [],
      status: 'published',
      published_at: 1n,
      kind: 'flashcards',
      content: {
        kind: 'flashcards',
        cards: [{ cardId: 11n, front: fixture.cardFront, back: fixture.cardBack }]
      }
    });

    return <MaterialVersionContent version={version} />;
  }

  const parts =
    feature === 'source'
      ? fixture.transcript.map((text) => ({ type: 'segment', text }))
      : [
          { type: 'heading', text: fixture.title },
          { type: 'paragraph', text: fixture.intro },
          { type: 'heading', text: fixture.heading },
          { type: 'paragraph', text: fixture.paragraph }
        ];
  const document = Schema.decodeUnknownSync(documentSchema)({
    blocks: parts.map(({ type, text }, index) => ({
      id: `sample-${index + 1}`,
      kind: type,
      text,
      content: {
        type,
        ...(type === 'heading' ? { level: index === 0 ? 1 : 2 } : {}),
        inlines: [{ type: 'text', text, marks: [] }]
      },
      anchor:
        feature === 'source'
          ? { type: 'time', startMs: 122000 + index * 61000, endMs: 183000 + index * 61000 }
          : { type: 'authored' }
    })),
    meta: {
      extractor: null,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: []
    }
  });

  return <DocumentReader document={document} />;
}
