import type * as s from '@study/db/schema';

import type { MaterialContentInput, MaterialKind } from './schemas.ts';

type SourceContent = Extract<MaterialContentInput, { sourceId: bigint }> & {
  source: typeof s.sources.$inferSelect;
};

type Question = typeof s.material_quiz_questions.$inferSelect;

type Choice = typeof s.material_quiz_choices.$inferSelect;

// Output identities belong to snapshots while card identities survive draft replacement.
type InputQuestion = Extract<MaterialContentInput, { kind: 'quiz' }>['questions'][number];

export type QuizQuestionDetail = InputQuestion extends infer Q
  ? Q extends { kind: string }
    ? Q & { id: Question['id'] } & (Q extends { choices: object[] }
          ? { choices: (Q['choices'][number] & { id: Choice['id'] })[] }
          : object)
    : never
  : never;

export type ContentDetail =
  | SourceContent
  | Extract<MaterialContentInput, { kind: 'document' | 'diagram' }>
  | { kind: 'quiz'; questions: QuizQuestionDetail[] }
  | { kind: 'flashcards'; cards: { cardId: bigint; front: string; back: string }[] };

type VersionBase = Omit<typeof s.material_versions.$inferSelect, 'kind'> & {
  inputs: bigint[];
  parents: bigint[];
};

export type MaterialVersionDetail = {
  [K in MaterialKind]: VersionBase & { kind: K; content: Extract<ContentDetail, { kind: K }> };
}[MaterialKind];

export type PublishedMaterialVersion = MaterialVersionDetail & {
  status: 'published';
  published_at: bigint;
};

export type DraftMaterialVersion = MaterialVersionDetail & {
  status: 'draft';
  published_at: null;
};

export type MaterialDetail = typeof s.materials.$inferSelect & {
  /** Latest published head, falling back to the latest draft for an unpublished material. */
  version: MaterialVersionDetail;
  latestPublishedVersion: PublishedMaterialVersion | null;
  latestDraftVersion: DraftMaterialVersion | null;
};

/** Collection shape excludes all potentially large content payloads. */
export type MaterialSummary = typeof s.materials.$inferSelect & {
  version: typeof s.material_versions.$inferSelect;
  latestPublishedVersion: typeof s.material_versions.$inferSelect | null;
  latestDraftVersion: typeof s.material_versions.$inferSelect | null;
};
