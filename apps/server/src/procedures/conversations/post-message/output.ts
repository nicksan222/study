import { Schema } from 'effect';

export { messageViewSchema as outputSchema } from '#server/shared/conversations/schemas';
import { messageViewSchema } from '#server/shared/conversations/schemas';

export type Output = typeof messageViewSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(messageViewSchema);
