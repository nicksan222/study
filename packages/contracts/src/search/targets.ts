import { Schema } from 'effect';

import { projectIdSchema, noteIdSchema } from '../ids.ts';

export const projectSearchTargetSchema = Schema.Struct({
  type: Schema.Literal('project'),
  id: projectIdSchema
});

export const noteSearchTargetSchema = Schema.Struct({
  type: Schema.Literal('note'),
  noteId: noteIdSchema
});
