import { glob } from 'astro/loaders';
// Each localized guide owns its copy and example composition; its filename is the route slug.
import { defineCollection, z } from 'astro:content';

/** The sidebar's sections, in order; their names are in strings.ts. */
export const sections = ['start', 'capture', 'pages', 'practice', 'reference'] as const;

const docs = defineCollection({
  loader: glob({ pattern: '{en,it}/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    headline: z.string(),
    stage: z
      .object({
        example: z.enum([
          'note',
          'answer',
          'page',
          'flashcards',
          'quiz',
          'sources',
          'search',
          'settings',

          'activity',
          'install'
        ]),
        phase: z.enum(['start', 'result']).optional()
      })
      .optional(),
    // The sidebar groups pages by section, then sorts them by order.
    section: z.enum(sections),
    order: z.number()
  })
});

export const collections = { docs };
