/** Closed storage kinds; transformations such as summarize preserve document shape. */
export const materialKinds = [
  'file',
  'audio',
  'video',
  'image',
  'link',
  'document',
  'diagram',
  'quiz',
  'flashcards'
] as const;

export const materialOperations = [
  'original',
  'edit',
  'summarize',
  'translate',
  'generate',
  'extract',
  'transcribe'
] as const;

export type MaterialKind = (typeof materialKinds)[number];

export type MaterialOperation = (typeof materialOperations)[number];
