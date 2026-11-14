import { signInStatusSchema } from '@study/contracts/auth/schemas';
import { aiProviderSchema, llmSettingsSchema } from '@study/contracts/settings/schemas';
import { Schema } from 'effect';

const aiConfigurationSchema = Schema.Struct({
  status: signInStatusSchema,
  providers: Schema.Array(aiProviderSchema),
  settings: llmSettingsSchema
});

/** Aggregate presentation data inferred from the canonical account and preference schemas. */
export type AiConfiguration = typeof aiConfigurationSchema.Type;
