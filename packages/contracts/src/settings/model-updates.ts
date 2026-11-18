import { Schema } from 'effect';

export const modelTiers = ['tiny', 'medium', 'smart'] as const;

const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const modelUpdateSchema = Schema.Struct({
  tier: Schema.Literals(modelTiers),
  provider: Schema.Union([Schema.Literal(1), identifier]),
  model: identifier,
  previousModel: identifier
});

export const modelCatalogSchema = Schema.Record(Schema.String, Schema.Array(identifier));

export const modelCatalogViewSchema = Schema.Struct({
  models: modelCatalogSchema,
  recommendations: Schema.Array(modelUpdateSchema)
});

export type ModelUpdate = typeof modelUpdateSchema.Type;
