import { catalogs } from './catalog.ts';
import type { Locale, MessageKey } from './catalog.ts';
import type { ParameterNames } from './parameters.ts';

export const localeCode = (locale: Locale): 'en' | 'it' => (locale === 'italian' ? 'it' : 'en');

/** Values are inserted literally; renderers remain responsible for escaping HTML. */
export type MessageParameters<K extends MessageKey> = {
  [P in ParameterNames<(typeof catalogs.english)[K]>]: string | number | bigint;
};

/** Keys suitable for labels and other copy that takes no parameters. */
export type StaticMessageKey = {
  [K in MessageKey]: keyof MessageParameters<K> extends never ? K : never;
}[MessageKey];

type ParameterizedMessageKey = Exclude<MessageKey, StaticMessageKey>;

type ExactParameters<K extends ParameterizedMessageKey, P extends MessageParameters<K>> = P &
  Record<Exclude<keyof P, keyof MessageParameters<K>>, never>;

/** A tuple union preserves the relationship between each key and its parameters. */
export type TranslationArguments =
  | [key: StaticMessageKey]
  | {
      [K in ParameterizedMessageKey]: [key: K, parameters: MessageParameters<K>];
    }[ParameterizedMessageKey];

export interface Translate {
  (key: StaticMessageKey): string;
  <K extends ParameterizedMessageKey, const P extends MessageParameters<K>>(
    key: K,
    parameters: ExactParameters<K, P>
  ): string;
}

const plurals = {
  en: {
    file_one: '{count} file',
    file_other: '{count} files',
    card_one: '{count} card',
    card_other: '{count} cards',
    source_one: '{count} source',
    source_other: '{count} sources',
    session_one: '{count} session',
    session_other: '{count} sessions',
    reply_one: '{count} reply',
    reply_other: '{count} replies',
    thread_one: '{count} thread',
    thread_other: '{count} threads',
    project_one: '{count} project',
    project_other: '{count} projects',
    result_one: '{count} result ready',
    result_other: '{count} results ready'
  },
  it: {
    file_one: '{count} file',
    file_other: '{count} file',
    card_one: '{count} flashcard',
    card_other: '{count} flashcard',
    source_one: '{count} fonte',
    source_other: '{count} fonti',
    session_one: '{count} sessione',
    session_other: '{count} sessioni',
    reply_one: '{count} risposta',
    reply_other: '{count} risposte',
    thread_one: '{count} thread',
    thread_other: '{count} thread',
    project_one: '{count} progetto',
    project_other: '{count} progetti',
    result_one: '{count} risultato pronto',
    result_other: '{count} risultati pronti'
  }
} as const;

export type CountKey = keyof typeof plurals.en extends `${infer Key}_${'one' | 'other'}`
  ? Key
  : never;

const pluralRules = {
  english: new Intl.PluralRules('en'),
  italian: new Intl.PluralRules('it')
};

/** Translate without shared mutable language state. Parameters are required by key. */
export function text(locale: Locale, key: StaticMessageKey): string;

export function text<K extends ParameterizedMessageKey, const P extends MessageParameters<K>>(
  locale: Locale,
  key: K,
  parameters: ExactParameters<K, P>
): string;

export function text(
  locale: Locale,
  key: MessageKey,
  parameters?: Record<string, string | number | bigint>
): string {
  return translate(locale, key, parameters);
}

function translate(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number | bigint>
): string {
  return catalogs[locale][key].replace(/\{([^{}]+)\}/g, (_, name: string) => {
    if (!values || !Object.hasOwn(values, name)) {
      throw new TypeError(`Missing parameter "${name}" for message "${key}"`);
    }

    return String(values[name]);
  });
}

export function countText(locale: Locale, key: CountKey, count: number): string {
  const category = pluralRules[locale].select(count) === 'one' ? 'one' : 'other';

  return plurals[localeCode(locale)][`${key}_${category}`].replace('{count}', String(count));
}

/** A synchronous, immutable translator. Methods can safely be destructured. */
export interface Localization {
  readonly locale: Locale;
  readonly t: Translate;
  readonly count: (key: CountKey, value: number) => string;
  readonly number: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  /** Unix seconds, matching Study timestamps. Options replace the default medium date and short time styles. */
  readonly date: (unixSeconds: number | bigint, options?: Intl.DateTimeFormatOptions) => string;
}

export function createLocalization(locale: Locale): Localization {
  const language = locale === 'italian' ? 'it-IT' : 'en-US';
  const numbers = new Intl.NumberFormat(language);
  const dateOptions = { dateStyle: 'medium', timeStyle: 'short' } as const;
  const dates = new Intl.DateTimeFormat(language, dateOptions);

  return Object.freeze({
    locale,
    t: (key: MessageKey, parameters?: Record<string, string | number | bigint>) =>
      translate(locale, key, parameters),
    count: (key: CountKey, value: number) => countText(locale, key, value),
    number: (value: number | bigint, options?: Intl.NumberFormatOptions) =>
      (options ? new Intl.NumberFormat(language, options) : numbers).format(value),
    date: (unixSeconds: number | bigint, options?: Intl.DateTimeFormatOptions) =>
      (options ? new Intl.DateTimeFormat(language, options) : dates).format(
        Number(unixSeconds) * 1000
      )
  });
}
