import { Schema } from 'effect';

export { messageViewSchema as outputSchema } from '#backend/shared/conversations/schemas';
import { messageViewSchema } from '#backend/shared/conversations/schemas';

export type Output = typeof messageViewSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(messageViewSchema);
