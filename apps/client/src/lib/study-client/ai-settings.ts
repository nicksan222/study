import { signInStatusSchema, aiProviderSchema, llmSettingsSchema } from '@study/contracts';
import { Schema } from 'effect';

const aiConfigurationSchema = Schema.Struct({
  status: signInStatusSchema,
  providers: Schema.Array(aiProviderSchema),
  settings: llmSettingsSchema
});

/** Aggregate presentation data inferred from the canonical account and preference schemas. */
export type AiConfiguration = typeof aiConfigurationSchema.Type;
