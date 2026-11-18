/** @file Native Effect model layers and the ownership check at the provider request boundary. */
import type { StudyError } from '@study/contracts';
import { Context, Effect } from 'effect';
import type { Schema } from 'effect';
import type { LanguageModel, Model, Tool } from 'effect/ai';

export type AiModel = Model.Model<string, LanguageModel.LanguageModel, never> & {
  readonly withOutputSchema?: (schema: Schema.Top & Schema.ConstraintDecoder<unknown>) => {
    model: AiModel;
    codec: Schema.ConstraintDecoder<unknown>;
  };
  readonly providerTools?: Partial<Record<'web_search', Tool.Any>>;
  readonly supportsMixedTools?: boolean;
};

/** Providers run this after any credential wait and immediately before sending the request. */
export const AiRequestCheck = Context.Reference<Effect.Effect<void, StudyError>>(
  'study/AiRequestCheck',
  {
    defaultValue: () => Effect.void
  }
);
