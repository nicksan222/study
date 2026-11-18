/** Interactive written examinations use an exact page selection and a bounded transcript. */
import { Schema } from 'effect';

import { pageVersionIdSchema, projectIdSchema } from '../ids.ts';

export const writtenExamAnswerLimit = 4000;

export const writtenExamTopicLimit = 240;

export const writtenExamTurnLimit = 10;

const writtenText = (max: number) =>
  Schema.String.check(
    Schema.isMaxLength(max),
    Schema.makeFilter((text: string) => text.trim().length > 0)
  );

const concept = writtenText(writtenExamTopicLimit);

const question = writtenText(800);

const reply = writtenText(600);

const hint = writtenText(600);

const promptFields = { question, reply: Schema.optional(reply), hint: Schema.optional(hint) };

const answer = writtenText(writtenExamAnswerLimit);

const exchange = Schema.Struct({ ...promptFields, answer });

const writtenExamStepSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('start'), topic: Schema.optional(concept) }),
  Schema.Struct({
    kind: Schema.Literal('answer'),
    concept,
    history: Schema.NonEmptyArray(exchange).check(Schema.isMaxLength(writtenExamTurnLimit))
  }),
  Schema.Struct({
    kind: Schema.Literal('finish'),
    concept,
    history: Schema.Array(exchange).check(Schema.isMaxLength(writtenExamTurnLimit))
  }),
  Schema.Struct({
    kind: Schema.Literal('hint'),
    concept,
    history: Schema.Array(exchange).check(Schema.isMaxLength(writtenExamTurnLimit - 1)),
    current: Schema.Struct(promptFields),
    draft: Schema.optional(answer)
  })
]);

export const writtenExamInputSchema = Schema.Struct({
  projectId: projectIdSchema,
  inputs: Schema.NonEmptyArray(
    Schema.Struct({ kind: Schema.Literal('page'), versionId: pageVersionIdSchema })
  ).check(Schema.isMaxLength(20)),
  step: writtenExamStepSchema
});

export const writtenExamResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('opening'), concept, question }),
  Schema.Struct({ kind: Schema.Literal('question'), question, reply }),
  Schema.Struct({ kind: Schema.Literal('hint'), message: hint }),
  Schema.Struct({
    kind: Schema.Literal('summary'),
    understood: Schema.Boolean,
    feedback: writtenText(3000)
  }),
  Schema.Struct({ kind: Schema.Literal('unavailable') })
]);

export const writtenExamAgentInputSchema = Schema.Struct({
  step: writtenExamStepSchema,
  evidence: Schema.Array(Schema.Struct({ name: Schema.String, preview: Schema.String }))
});

export const writtenExamAgentOutputSchema = Schema.Struct({ next: writtenExamResultSchema });

export type WrittenExamInput = typeof writtenExamInputSchema.Type;

export type WrittenExamResult = typeof writtenExamResultSchema.Type;
