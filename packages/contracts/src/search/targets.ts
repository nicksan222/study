import { Schema } from 'effect';

import { projectIdSchema, sessionIdSchema } from '../ids.ts';

export const projectSearchTargetSchema = Schema.Struct({
  type: Schema.Literal('project'),
  id: projectIdSchema
});

export const sessionSearchTargetSchema = Schema.Struct({
  type: Schema.Literal('session'),
  sessionId: sessionIdSchema
});
