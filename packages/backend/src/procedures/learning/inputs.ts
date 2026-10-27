import * as s from '@study/db/schema';
import { z } from 'zod';

import { idInput } from '#backend/runtime/trpc';

export const attemptInput = z.object({ attemptId: idInput });

export const cardInput = z.object({ versionId: idInput, cardId: idInput });

export const takeInput = z.number().int().min(1).max(100).default(30);

export const ratingInput = z.enum(s.material_card_reviews.rating.enumValues);

export const answerInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), answer: z.string().trim().min(1).max(100000) }),
  z.object({ type: z.literal('choice'), choiceIds: z.array(idInput).min(1).max(100) })
]);
