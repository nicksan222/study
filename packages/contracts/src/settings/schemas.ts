import { Schema } from 'effect';

export const appSettingsSchema = Schema.Struct({
  language: Schema.Literals([1, 2]),
  appearance: Schema.Literals([1, 2, 3]),
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

export type ModelTier = keyof typeof llmSettingsSchema.fields;

export const materialSettingsSchema = Schema.Struct({
  sift: Schema.Boolean
});

export const reviewSettingsSchema = Schema.Struct({
  newCardsPerDay: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 }))
});

export const appearancePreferencesSchema = Schema.Struct({
  contrast: Schema.Int.check(Schema.isBetween({ minimum: 75, maximum: 150 })),
  glassOpacity: Schema.Int.check(Schema.isBetween({ minimum: 40, maximum: 100 })),
  animationDurationMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 400 }))
});

export const concurrencySettingsSchema = Schema.Struct({
  maxConcurrentAi: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  maxQueuedAi: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 64 }))
});

export const sidebarSettingsSchema = Schema.Struct({
  settledDocumentThreshold: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
});
