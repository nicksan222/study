import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
// The Study website: the landing page and the docs, in English (/) and Italian (/it/),
// built to static files for GitHub Pages under /study.
//
// Docs pages that show the app are MDX, so a plain Markdown image can render
// through an Astro component: `![alt](shot:name "caption")` and `![alt](clip:name "caption")`
// stay ordinary Markdown to write and translate, while `Media.astro` picks the capture in
// the page's language and the reader's theme and makes its sizes at build time, which a
// remark or rehype plugin on plain Markdown cannot do (it cannot call `getImage` or render
// a component). Pages without media stay `.md`.
import { defineConfig } from 'astro/config';

/**
 * Lifts a paragraph that holds only a `shot:` or `clip:` image out to the image itself, so
 * the figure it renders as never sits inside a `<p>`.
 */
function remarkDocsMedia() {
  const media = (node) => node.type === 'image' && /^(shot|clip):/.test(node.url);
  const lift = (node) => {
    if (!node.children) return;

    node.children = node.children.map((child) =>
      child.type === 'paragraph' && child.children.length === 1 && media(child.children[0])
        ? child.children[0]
        : child
    );
    node.children.forEach(lift);
  };

  return lift;
}

export default defineConfig({
  site: 'https://nicksan222.github.io',
  base: '/study',
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'it'],
    routing: { prefixDefaultLocale: false }
  },
  markdown: { processor: unified({ remarkPlugins: [remarkDocsMedia] }) },
  integrations: [mdx()],
  // The logo masters, fonts and icons are the app's own files, outside this folder.
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '#brand': Bun.fileURLToPath(new URL('../../packages/ui/assets', import.meta.url)),
        // Static previews replace data hooks; production keeps the real services.
        '#client/lib/ai-readiness.ts': Bun.fileURLToPath(
          new URL('./src/previews/ai-readiness.ts', import.meta.url)
        ),
        '#client/lib/study-client/workspace-preferences.queries.ts': Bun.fileURLToPath(
          new URL('./src/previews/workspace-preferences.ts', import.meta.url)
        ),
        '#client': Bun.fileURLToPath(new URL('../client/src', import.meta.url))
      }
    },
    server: { fs: { allow: ['../..'] } }
  }
});
