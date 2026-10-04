// The docs, one Markdown page per feature in each language: MDX when it shows captures of
// the app inline (see astro.config.mjs). A page's file name is its slug, and the English
// and Italian pages of one feature share it.
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** The sidebar's sections, in order; their names are in strings.ts. */
export const sections = ['start', 'learn', 'more'] as const;

const docs = defineCollection({
  loader: glob({ pattern: '{en,it}/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // The sidebar groups pages by section, then sorts them by order.
    section: z.enum(sections),
    order: z.number(),
    // The capture at the top of the page, from src/assets/shots by name (session, citation, …).
    shot: z.string().optional(),
    shotAlt: z.string().optional(),
  }),
});

export const collections = { docs };
