import { Schema } from 'effect';

import { messageIdSchema, versionIdSchema } from '../ids.ts';

export const conversionStrategyIdSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)
);

const conversionInputKindSchema = Schema.Literals(['text', 'pdf']);

export const conversionStrategySchema = Schema.Struct({
  id: conversionStrategyIdSchema,
  name: Schema.String,
  supportedInputs: Schema.Array(conversionInputKindSchema)
});

export const convertMessageInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  expectedActiveVersionId: versionIdSchema,
  strategyId: conversionStrategyIdSchema
});

export const messageConversionSchema = Schema.Struct({
  strategyId: conversionStrategyIdSchema,
  baseVersionId: versionIdSchema
});

export const textConversionInputSchema = Schema.Struct({
  text: Schema.String.check(Schema.isBetweenLength(1, 100000))
});

export const textConversionOutputSchema = Schema.String.check(Schema.isBetweenLength(1, 100000));
