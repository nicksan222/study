import { Schema } from 'effect';

import type { Account } from '#server/platform/ai/providers/chatgpt/session';

const accountSchema = Schema.Struct({
  subject: Schema.String,
  clientId: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  sharing: Schema.Boolean,
  email: Schema.optionalKey(Schema.String)
});

/** Validate private credentials read from the preferences database. */
export const decodeAccount = Schema.decodeUnknownSync(accountSchema);

/** Return a JSON-compatible copy of the private credentials. */
export function encodeAccount(account: Account): Schema.Json {
  return Schema.encodeSync(accountSchema)(account);
}
