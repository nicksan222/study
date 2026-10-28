import { Schema } from 'effect';

export const appSettingsSchema = Schema.Struct({
  language: Schema.Literals([1, 2]),
  appearance: Schema.Literals([1, 2]),
  zoomPercent: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 200 })),
  onboarded: Schema.Boolean
});

export const tierSetupSchema = Schema.Struct({
  provider: Schema.Literal(1),
  model: Schema.optional(Schema.Literals([1, 2, 3]))
});

export const llmSettingsSchema = Schema.Struct({
  tiny: tierSetupSchema,
  medium: tierSetupSchema,
  smart: tierSetupSchema
});

export const materialSettingsSchema = Schema.Struct({
  sift: Schema.Boolean
});

export const reviewSettingsSchema = Schema.Struct({
  newCardsPerDay: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 }))
});
