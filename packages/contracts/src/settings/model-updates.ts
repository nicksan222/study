import { Schema } from 'effect';

export const modelTiers = ['tiny', 'medium', 'smart'] as const;

const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const modelUpdateSchema = Schema.Struct({
  tier: Schema.Literals(modelTiers),
  provider: Schema.Union([Schema.Literal(1), identifier]),
  model: identifier,
  previousModel: Schema.optionalKey(identifier)
});

export const modelCatalogSchema = Schema.Record(Schema.String, Schema.Array(identifier));

export const modelSuggestionsSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    tiny: Schema.optionalKey(identifier),
    medium: Schema.optionalKey(identifier),
    smart: Schema.optionalKey(identifier)
  })
);

export type ModelSuggestions = typeof modelSuggestionsSchema.Type;

export const modelCatalogViewSchema = Schema.Struct({
  models: modelCatalogSchema,
  suggestions: Schema.optionalKey(modelSuggestionsSchema),
  recommendations: Schema.Array(modelUpdateSchema)
});

export type ModelUpdate = typeof modelUpdateSchema.Type;
