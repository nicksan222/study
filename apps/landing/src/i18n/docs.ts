// The docs in one language, in sidebar order, grouped by section.
import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from './strings';

export type Doc = CollectionEntry<'docs'>;
export const sections = ['start', 'learn', 'more'] as const;

/** A doc's slug: its file name, shared by the English and the Italian page. */
export const slug = (doc: Doc) => doc.id.split('/').pop()!;

export async function docsIn(lang: Lang): Promise<Doc[]> {
  const all = await getCollection('docs', (doc) => doc.id.startsWith(`${lang}/`));
  return all.sort(
    (a, b) =>
      sections.indexOf(a.data.section) - sections.indexOf(b.data.section) || a.data.order - b.data.order,
  );
}
