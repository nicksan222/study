/** CSS-free preview metadata, safe for content schema loading before Vite starts. */
export const previewFeatures = ['document', 'source', 'quiz', 'flashcards'] as const;

export type PreviewFeature = (typeof previewFeatures)[number];
