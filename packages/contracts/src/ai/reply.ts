import { Schema } from 'effect';

import { messageRoleSchema } from '../conversations/schemas.ts';

const modelMessageSchema = Schema.Struct({
  role: messageRoleSchema,
  content: Schema.String
});

export const replyInputSchema = Schema.Struct({ messages: Schema.Array(modelMessageSchema) });

export const replyOutputSchema = Schema.String;
