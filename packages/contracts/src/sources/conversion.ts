import { Schema } from 'effect';

export const conversionStrategyIdSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)
);

const conversionInputKindSchema = Schema.Literals(['text', 'pdf']);

export const conversionStrategySchema = Schema.Struct({
  id: conversionStrategyIdSchema,
  name: Schema.String,
  supportedInputs: Schema.Array(conversionInputKindSchema)
});

export const textConversionInputSchema = Schema.Struct({
  text: Schema.String.check(
    Schema.isBetweenLength(1, 100000),
    Schema.makeFilter((text) => text.trim().length > 0)
  )
});

export const textConversionOutputSchema = Schema.String.check(Schema.isBetweenLength(1, 100000));
