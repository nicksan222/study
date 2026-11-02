/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Extracts readable article or body content from HTML into canonical document blocks │
 * │ while excluding page chrome.                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Source decoders convert bounded input bytes into canonical document data.              │
 * │ - Validates format input and constructs decoded content.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Does not choose ingestion policy or persist source state.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createBlock } from '@study/contracts/sources/document';
import type { Block, Document } from '@study/contracts/sources/document';
import type { Inline, BlockContent } from '@study/contracts/sources/schemas';
import { loadBuffer } from 'cheerio';

import { checkAbort, document } from './common.ts';

export function decodeHtml(
  input: { bytes: Uint8Array; url?: string },
  signal?: AbortSignal
): Document {
  checkAbort(signal);
  const $ = loadBuffer(Buffer.from(input.bytes));

  $('script,style,noscript,nav,footer,header,aside').remove();
  const root = $('article,main').first().length ? $('article,main').first() : $('body');

  type Node = ReturnType<typeof root.contents>[number];

  const blocks: Block[] = [];
  const flowContainers = new Set([
    'p',
    'div',
    'main',
    'article',
    'section',
    'blockquote',
    'address',
    'figure',
    'figcaption',
    'details',
    'summary',
    'header',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'pre'
  ]);
  // Unknown wrappers may contain recognized flow content. Only true phrasing subtrees
  // belong in the inline buffer, whose decoder intentionally excludes lists and tables.
  const flowNodes = new WeakMap<Node, boolean>();

  function containsFlow(node: Node): boolean {
    if (node.type !== 'tag') return false;

    const cached = flowNodes.get(node);

    if (cached !== undefined) return cached;

    const flow =
      flowContainers.has(node.tagName) ||
      ['ul', 'ol', 'table'].includes(node.tagName) ||
      $(node).contents().toArray().some(containsFlow);

    flowNodes.set(node, flow);

    return flow;
  }

  const hasPhrasing = (nodes: Node[]) =>
    nodes.some(
      (node) => node.type === 'tag' || (node.type === 'text' && node.data.trim().length > 0)
    );
  const omissions = new Set<Document['meta']['omissions'][number]>(['unsupported_markup']);
  const marks: Record<string, Extract<Inline, { type: 'text' }>['marks'][number]> = {
    b: 'strong',
    strong: 'strong',
    i: 'emphasis',
    em: 'emphasis',
    code: 'code',
    s: 'strike',
    del: 'strike',
    sub: 'subscript',
    sup: 'superscript'
  };

  function readLink(node: Node): Inline[] | null {
    const href = $(node).attr('href');

    try {
      const url = new URL(href ?? '', input.url);

      if (['https:', 'http:', 'mailto:'].includes(url.protocol))
        return [{ type: 'link', href: url.href, text: $(node).text() }];
    } catch {
      omissions.add('unsupported_markup');
    }

    return null;
  }

  function inline(
    nodes: Node[],
    active: Extract<Inline, { type: 'text' }>['marks'] = []
  ): Inline[] {
    return nodes.flatMap((node): Inline[] => {
      if (node.type === 'text')
        return [{ type: 'text', text: node.data.replace(/\s+/g, ' '), marks: active }];

      if (node.type !== 'tag') return [];

      if (['ul', 'ol', 'table'].includes(node.tagName)) return [];

      if (node.tagName === 'br') return [{ type: 'break' }];

      if (node.tagName === 'img') {
        omissions.add('embedded_media');

        return [];
      }

      if (node.tagName === 'a') {
        const link = readLink(node);

        if (link) return link;
      }

      return inline(
        $(node).contents().toArray(),
        marks[node.tagName] ? [...active, marks[node.tagName]!] : active
      );
    });
  }

  function add(content: BlockContent, node: Node) {
    const fragment = $(node).attr('id') ?? $(node).closest('[id]').attr('id') ?? null;

    blocks.push(
      createBlock(
        content,
        input.url
          ? { type: 'url', url: input.url, fragment }
          : { type: 'paragraph', index: blocks.length + 1 }
      )
    );
  }

  function list(node: Node) {
    const items: Extract<BlockContent, { type: 'list_item' }>['items'][number][] = [];

    function visit(parent: Node, depth: number) {
      if (depth > 16) {
        omissions.add('unsupported_markup');

        return;
      }

      $(parent)
        .children('li')
        .each((index, item) => {
          let pending: Node[] = [];
          let emitted = false;
          const save = (requireParent = false) => {
            if (hasPhrasing(pending) || (requireParent && !emitted)) {
              items.push({
                depth,
                ordered: parent.type === 'tag' && parent.tagName === 'ol',
                start: Math.max(1, Number($(parent).attr('start')) || 1) + index,
                continuation: emitted,
                inlines: inline(pending)
              });
              emitted = true;
            }

            pending = [];
          };

          const read = (children: Node[]) => {
            for (const child of children) {
              if (child.type === 'tag' && ['ul', 'ol'].includes(child.tagName)) {
                save(true);
                visit(child, depth + 1);
              } else if (child.type === 'tag' && containsFlow(child)) {
                save();
                read($(child).contents().toArray());
                save();
              } else pending.push(child);
            }
          };

          read($(item).contents().toArray());
          save(true);
        });
    }

    visit(node, 0);
    add({ type: 'list_item', items }, node);
  }

  function cellParagraphs(nodes: Node[]): Inline[][] {
    const paragraphs: Inline[][] = [];
    let pending: Node[] = [];
    const save = () => {
      if (pending.some((node) => node.type !== 'text' || node.data.trim().length > 0))
        paragraphs.push(inline(pending));

      pending = [];
    };

    for (const node of nodes) {
      if (
        node.type === 'tag' &&
        ['p', 'div', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName)
      ) {
        save();
        paragraphs.push(...cellParagraphs($(node).contents().toArray()));
      } else pending.push(node);
    }

    save();

    return paragraphs.length ? paragraphs : [[]];
  }

  function structured(node: Node, name: string): boolean {
    if (name === 'table') {
      if ($(node).find('table').length) omissions.add('nested_table');

      const rows = $(node)
        .find('tr')
        .toArray()
        .filter((row) => $(row).closest('table')[0] === node)
        .map((row) => ({
          cells: $(row)
            .children('th,td')
            .toArray()
            .map((cell) => ({
              header: cell.tagName === 'th',
              paragraphs: cellParagraphs($(cell).contents().toArray())
            }))
        }));

      add({ type: 'table', rows }, node);

      return true;
    }

    if (name === 'pre') {
      const language =
        $(node)
          .find('code')
          .attr('class')
          ?.match(/(?:^|\s)language-([\w+-]+)/)?.[1] ?? null;

      add({ type: 'code', code: $(node).text(), language }, node);

      return true;
    }

    if (/^h[1-6]$/.test(name)) {
      add(
        { type: 'heading', level: Number(name[1]), inlines: inline($(node).contents().toArray()) },
        node
      );

      return true;
    }

    if (name === 'p') {
      add({ type: 'paragraph', inlines: inline($(node).contents().toArray()) }, node);

      return true;
    }

    return false;
  }

  function walk(nodes: Node[]): void {
    let pending: Node[] = [];
    const save = () => {
      if (hasPhrasing(pending)) {
        const inlines = inline(pending);

        if (inlines.length) add({ type: 'paragraph', inlines }, pending[0]!);
      }

      pending = [];
    };

    for (const node of nodes) {
      if (node.type !== 'tag') {
        pending.push(node);
        continue;
      }

      const name = node.tagName;

      if (name === 'ul' || name === 'ol') {
        save();
        list(node);
      } else if (containsFlow(node)) {
        save();

        if (!structured(node, name)) walk($(node).contents().toArray());
      } else pending.push(node);
    }

    save();
  }

  walk(root.contents().toArray());
  const result = document(blocks, 'web');

  result.meta.omissions = [...omissions];

  return result;
}
