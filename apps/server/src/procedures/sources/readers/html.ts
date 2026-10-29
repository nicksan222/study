import { loadBuffer } from 'cheerio';

import type { Block } from '#server/shared/sources/document';

import { checkAbort, document } from './common.ts';
import type { Reader } from './types.ts';

export const webReader: Reader = {
  kind: 'web',
  async read(input, options) {
    checkAbort(options?.signal);
    const $ = loadBuffer(Buffer.from(input.bytes));

    $('script,style,noscript,nav,footer,header,aside').remove();
    const root = $('article,main').first().length ? $('article,main').first() : $('body');
    const blocks: Block[] = [];
    const roots = root.contents().toArray();

    type Node = (typeof roots)[number];

    let pending = '',
      kind: Block['kind'] = 'paragraph',
      fragment: string | null = null;
    const flush = () => {
      const text = pending.replace(/\s+/g, ' ').trim();

      if (text)
        blocks.push({
          kind,
          text,
          anchor: input.url
            ? { type: 'url', url: input.url, fragment }
            : { type: 'paragraph', index: blocks.length + 1 }
        });

      pending = '';
    };
    const walk = (node: Node): void => {
      if (node.type === 'text') {
        pending += node.data;

        return;
      }

      if (node.type !== 'tag') return;

      const name = node.tagName.toLowerCase();

      if (name === 'br') {
        pending += ' ';

        return;
      }

      if (name === 'tr') {
        flush();
        const text = $(node)
          .find('th,td')
          .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
          .get()
          .join(' | ');

        if (text) {
          pending = text;
          kind = 'table';
          fragment = $(node).attr('id') ?? $(node).closest('[id]').attr('id') ?? null;
          flush();
        }

        return;
      }

      const block = /^(h[1-6]|p|li|pre|div|section|article|main|ul|ol|table)$/.test(name);
      const oldKind = kind,
        oldFragment = fragment;

      if (block) {
        flush();
        kind = /^h[1-6]$/.test(name)
          ? 'heading'
          : name === 'li'
            ? 'list_item'
            : name === 'pre'
              ? 'code'
              : 'paragraph';
        fragment = $(node).attr('id') ?? $(node).closest('[id]').attr('id') ?? null;
      }

      $(node).contents().toArray().forEach(walk);

      if (block) {
        flush();
        kind = oldKind;
        fragment = oldFragment;
      }
    };

    roots.forEach(walk);
    flush();

    return document(blocks, 'web');
  }
};
