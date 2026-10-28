import { Schema } from 'effect';

export const publicAccountSchema = Schema.Struct({
  subject: Schema.String,
  email: Schema.Union([Schema.String, Schema.Undefined]),
  sharing: Schema.Boolean
});

export const signInStatusSchema = Schema.Struct({
  signedIn: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
  sharing: Schema.Boolean
});

export const signInAttemptSchema = Schema.Struct({
  url: Schema.String,
  attemptId: Schema.String
});
