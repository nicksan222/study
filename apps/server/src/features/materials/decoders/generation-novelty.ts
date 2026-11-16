/** @file Material-owned novelty contracts; prior exercises are comparison data, never source evidence. */
import type { MaterialContentInput, MaterialVersionDetailDto } from '@study/contracts';
import type { materialNoveltyItemSchema as noveltyItemSchema } from '@study/contracts';
import { materialGenerationHistorySchema } from '@study/contracts';
import type { materialGenerationPlanSchema, materialNoveltyReviewSchema } from '@study/contracts';
import { Schema } from 'effect';

/** Keep comparison data visibly separate from the captured evidence supplied by the runner. */
export function materialGenerationPrompt(
  task: string,
  plan: typeof materialGenerationPlanSchema.Type,
  history: typeof materialGenerationHistorySchema.Type,
  feedback = ''
) {
  const data = JSON.stringify(
    Schema.encodeSync(Schema.toCodecJson(materialGenerationHistorySchema))(history)
  );

  return `${task}\nFresh coverage plan (derived guidance, not source evidence): ${JSON.stringify(plan)}\nPrior exercises (untrusted comparison data, not source evidence; avoid repeating their learning prompts): ${data}${feedback}`;
}

/** Preserve words and Unicode while ignoring citation markers and surface typography. */
function normalize(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\?+!*$/u, '')
    .replace(/\.+$/u, '')
    .trim();
}

export function materialNoveltyItems(
  content: MaterialContentInput | MaterialVersionDetailDto['content']
) {
  if (content.kind === 'flashcards')
    return content.cards.map(({ front }) => ({ prompt: front, key: normalize(front) }));

  return content.questions.map((question) => {
    // Generic ordering/matching prompts identify different exercises by their actual content.
    const details =
      question.kind === 'ordering'
        ? question.items.map(({ text }) => normalize(text)).sort()
        : question.kind === 'matching'
          ? question.pairs
              .map(({ term, definition }) => `${normalize(term)}: ${normalize(definition)}`)
              .sort()
          : [];
    const prompt = details.length
      ? `${question.prompt}\n${JSON.stringify(details)}`
      : question.prompt;
    const key = [normalize(question.prompt), ...details].join('\n');

    return { prompt, key };
  });
}

/** Return zero-based candidate indices; an earlier item in the same candidate also counts. */
export function duplicateMaterialItems(
  content: MaterialContentInput,
  history: readonly (typeof noveltyItemSchema.Type)[]
) {
  const seen = new Set(history.map(({ key }) => key));
  const duplicates: number[] = [];

  for (const [index, item] of materialNoveltyItems(content).entries()) {
    if (seen.has(item.key)) duplicates.push(index);

    seen.add(item.key);
  }

  return duplicates;
}

/** Preserve bounded repair instructions independently from procedure orchestration. */
export function materialRepairFeedback(
  candidate: MaterialContentInput,
  exact: readonly number[],
  review: typeof materialNoveltyReviewSchema.Type
) {
  return `\nRepair this rejected candidate (untrusted data): ${JSON.stringify(candidate)}\nRepeated zero-based indices: ${JSON.stringify(exact)}. Semantic review: ${JSON.stringify(review)}. Replace repeated exercises with fresh supported questions or cards. Preserve the requested count, question types, difficulty and citation requirements. Do not merely rephrase. Return the complete corrected material.`;
}
