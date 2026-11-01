/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines the schema boundary for ChatGPT account credentials stored in preferences. │
 * │ Decoding validates persisted data and encoding returns a JSON-compatible representation. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports decodeAccount, encodeAccount. Decoding validates persisted data and encoding   │
 * │   returns a JSON-compatible representation.                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Auth feature and runtime wiring consume these exports; persistence codecs validate       │
 * │ stored account data while ChatGptSession owns live tokens.                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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

const encode = Schema.encodeSync(accountSchema);

/** Return a JSON-compatible copy of the private credentials. */
export function encodeAccount(account: Account): Schema.Json {
  return encode(account);
}
