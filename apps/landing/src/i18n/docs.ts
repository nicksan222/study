// The docs in one language, in sidebar order, grouped by section.
import { getCollection, type CollectionEntry } from 'astro:content';
import { sections } from '../content.config';
import type { Lang } from './strings';

export { sections };
export type Doc = CollectionEntry<'docs'>;

/** A doc's slug: its file name, shared by the English and the Italian page. */
export const slug = (doc: Doc) => doc.id.split('/').pop()!;

/** The docs in `lang`, in sidebar order. Every page exists in English and Italian, or the
 * build fails naming the one missing, so the language switch never leads nowhere. */
export async function docsIn(lang: Lang): Promise<Doc[]> {
  const every = await getCollection('docs');
  const all = every.filter((doc) => doc.id.startsWith(`${lang}/`));
  const here = new Set(all.map(slug));
  const missing = every.find((doc) => !here.has(slug(doc)));
  if (missing) throw new Error(`docs/${missing.id} has no ${lang} page: add src/content/docs/${lang}/${slug(missing)}.md(x)`);
  return all.sort(
    (a, b) =>
      sections.indexOf(a.data.section) - sections.indexOf(b.data.section) || a.data.order - b.data.order,
  );
}
