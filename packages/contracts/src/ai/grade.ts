import { Schema } from 'effect';

import { learningVerdictSchema } from '../learning/schemas.ts';
export { promptInputSchema as gradeInputSchema } from './shared.ts';

export const gradeOutputSchema = Schema.Struct({
  verdict: learningVerdictSchema,
  feedback: Schema.String
});
