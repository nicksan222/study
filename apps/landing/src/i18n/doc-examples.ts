export type StudyExampleKind = 'note' | 'answer' | 'page' | 'flashcards' | 'quiz';

export type UtilityExampleKind = 'sources' | 'search' | 'settings' | 'activity' | 'install';

export type DocExample = StudyExampleKind | UtilityExampleKind;

export function isStudyExample(kind: DocExample): kind is StudyExampleKind {
  return ['note', 'answer', 'page', 'flashcards', 'quiz'].includes(kind);
}

export const previewFeatures = ['page', 'source', 'quiz', 'flashcards'] as const;

export type PreviewFeature = (typeof previewFeatures)[number];
