import { Schema } from 'effect';

import { messageIdSchema, versionIdSchema } from '../ids.ts';
import type { VersionId } from '../ids.ts';
import { conversionStrategyIdSchema } from '../sources/conversion.ts';
import type { conversionStrategySchema } from '../sources/conversion.ts';
import type { ChatMessage } from './messages.ts';

export const convertMessageInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  expectedActiveVersionId: versionIdSchema,
  strategyId: conversionStrategyIdSchema
});

export const messageConversionSchema = Schema.Struct({
  strategyId: conversionStrategyIdSchema,
  baseVersionId: versionIdSchema
});

/** Eligibility is shared by saved-message scheduling and the chat controls. */
export function canConvertMessage(
  message: Pick<ChatMessage, 'role' | 'parts' | 'versions'>,
  versionId: VersionId,
  supportedInputs: (typeof conversionStrategySchema.Type)['supportedInputs']
) {
  const version = message.versions.find((version) => version.id === versionId);

  return (
    message.role === 'user' &&
    ((supportedInputs.includes('text') && !!version?.text.trim()) ||
      (supportedInputs.includes('pdf') &&
        message.parts.some((part) => part.sourceKind === 'pdf' && part.sourceId !== null)))
  );
}
