import { Schema } from 'effect';

import { assistantContextBudget } from '../conversations/assistant.ts';

export const compactionInputSchema = Schema.Struct({
  previous: Schema.String,
  messages: Schema.Array(
    Schema.Struct({ role: Schema.Literals(['user', 'assistant']), text: Schema.String })
  )
});

export const compactionOutputSchema = Schema.String.check(
  Schema.isBetweenLength(1, assistantContextBudget.summary)
);
