// Committed docs captures are named `<name>-<lang>-<theme>`. Production requires the
// exact variant. Local development falls back to English and then the other theme.
import type { Lang } from '../i18n/strings';

export type Theme = 'light' | 'dark';

/** The file names to try for `name`, best first. */
function variants(name: string, lang: Lang, theme: Theme): string[] {
  const exact = `${name}-${lang}-${theme}`;

  if (import.meta.env.PROD) return [exact];

  const other: Theme = theme === 'light' ? 'dark' : 'light';

  return [exact, `${name}-en-${theme}`, `${name}-${lang}-${other}`, `${name}-en-${other}`];
}

/** The first of `name`'s variants that `find` has, or an error naming what is missing. */
export function pick<T>(
  name: string,
  lang: Lang,
  theme: Theme,
  find: (file: string) => T | undefined
): T {
  for (const file of variants(name, lang, theme)) {
    const found = find(file);

    if (found !== undefined) return found;
  }

  throw new Error(`no ${lang}-${theme} capture named ${name}: restore the committed capture asset`);
}
