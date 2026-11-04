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

/** OpenAI's local-app flow requires an IPv4 HTTP loopback callback. */
export const signInCallbackUrlSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'http:' &&
        url.hostname === '127.0.0.1' &&
        url.pathname === '/auth/callback' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  })
);
