import { english } from './english.ts';
import { italian } from './italian.ts';
import type { ParameterNames } from './parameters.ts';

type MatchingParameters = {
  [K in keyof typeof english]: [ParameterNames<(typeof english)[K]>] extends [
    ParameterNames<(typeof italian)[K]>
  ]
    ? [ParameterNames<(typeof italian)[K]>] extends [ParameterNames<(typeof english)[K]>]
      ? string
      : never
    : never;
};

/** Both locales have exactly the same keys and named interpolation parameters. */
export const catalogs = Object.freeze({
  english,
  italian: italian satisfies MatchingParameters
});

export type MessageKey = keyof typeof english;

export type Locale = keyof typeof catalogs;
