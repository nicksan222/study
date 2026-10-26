// Which capture of a piece of docs media to show. `just docs-media` makes each one in every
// language and theme, named `<name>-<lang>-<theme>`. A published build shows only the exact
// one, so a capture that failed to be made fails the build instead of showing the wrong
// language; while writing (`just landing`), a missing one falls back to English, then to the
// other theme, so a few scenes made by name are enough to see a page.
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
export function pick<T>(name: string, lang: Lang, theme: Theme, find: (file: string) => T | undefined): T {
  for (const file of variants(name, lang, theme)) {
    const found = find(file);
    if (found !== undefined) return found;
  }
  throw new Error(`no ${lang}-${theme} capture named ${name}: make it with \`just docs-media ${name}\``);
}
