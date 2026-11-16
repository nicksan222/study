/** Structural editor presentation; application adapters retain canonical decoding and persistence. */
export type PracticeAnswer =
  | { type: 'choice'; choiceIds: bigint[] }
  | { type: 'open'; answer: string }
  | { type: 'matching'; associations: { termId: string; definitionId: string }[] }
  | { type: 'ordering'; itemIds: bigint[] };

type Item<Id = bigint> = { id: Id; text: string };

type Base = { id: bigint; prompt: string };

export type PracticeQuestionModel = Base &
  (
    | {
        kind: 'single_choice' | 'multiple_choice' | 'true_false';
        choices: Item[];
        answer: Extract<PracticeAnswer, { type: 'choice' }> | null;
      }
    | { kind: 'open' | 'fill_blank'; answer: Extract<PracticeAnswer, { type: 'open' }> | null }
    | {
        kind: 'matching';
        terms: Item<string>[];
        definitions: Item<string>[];
        answer: Extract<PracticeAnswer, { type: 'matching' }> | null;
      }
    | {
        kind: 'ordering';
        items: Item[];
        answer: Extract<PracticeAnswer, { type: 'ordering' }> | null;
      }
  );

export type PracticeResultQuestionModel = Base & {
  explanation: string;
  score: number | null;
  feedback: string | null;
} & (
    | {
        kind: 'single_choice' | 'multiple_choice' | 'true_false';
        choices: (Item & { isCorrect: boolean })[];
        answer: Extract<PracticeAnswer, { type: 'choice' }> | null;
      }
    | {
        kind: 'open' | 'fill_blank';
        referenceAnswer: string | null;
        answer: Extract<PracticeAnswer, { type: 'open' }> | null;
      }
    | {
        kind: 'matching';
        terms: Item<string>[];
        definitions: Item<string>[];
        pairs: { termId: string; definitionId: string; score: number }[];
        answer: Extract<PracticeAnswer, { type: 'matching' }> | null;
      }
    | {
        kind: 'ordering';
        items: Item[];
        correctItemIds: bigint[];
        answer: Extract<PracticeAnswer, { type: 'ordering' }> | null;
      }
  );

export interface PracticeResultsModel {
  questions: PracticeResultQuestionModel[];
  scoring: { complete: boolean; score: number | null };
}
