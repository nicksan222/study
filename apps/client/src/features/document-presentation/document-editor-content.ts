import { sourceIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import type { BlockContent, Inline } from '@study/contracts/sources/schemas';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import type { StructuredEditorValue as Node } from '@study/ui/structured-editor';
import { Schema } from 'effect';

export type EditableDocument = typeof documentSchema.Type;

type ListContent = Extract<BlockContent, { type: 'list_item' }>;

type ListItem = ListContent['items'][number];

type TextMark = Extract<Inline, { type: 'text' }>['marks'][number];

const marks: Record<TextMark, string> = {
  strong: 'bold',
  emphasis: 'italic',
  code: 'code',
  strike: 'strike',
  subscript: 'subscript',
  superscript: 'superscript'
};

const textNode = (text: string): Node[] => (text ? [{ type: 'text', text }] : []);

function editorInlines(inlines: readonly Inline[]): Node[] {
  return inlines.flatMap((inline): Node[] => {
    if (inline.type === 'break') return [{ type: 'hardBreak' }];

    if (inline.type === 'math')
      return [{ type: 'documentInlineMath', content: textNode(inline.text) }];

    if (!inline.text) return [];

    return [
      {
        type: 'text',
        text: inline.text,
        marks:
          inline.type === 'link'
            ? [
                { type: 'link', attrs: { href: inline.href } },
                ...(inline.marks ?? []).map((mark) => ({ type: marks[mark] }))
              ]
            : inline.marks.map((mark) => ({ type: marks[mark] }))
      }
    ];
  });
}

/** Retains source block identity separately from the editor's transient node positions. */
export function documentToEditor(
  document: EditableDocument,
  images: Record<string, string> = {},
  readOnly = false
): Node {
  return {
    type: 'doc',
    content: document.blocks.length
      ? document.blocks.map((block) => {
          const node = contentToEditor(block.content, images);

          if (readOnly && block.content.type === 'reference')
            node.content = [
              ...(node.content ?? []),
              { type: 'hardBreak' },
              {
                type: 'text',
                text: block.content.href,
                marks: [{ type: 'link', attrs: { href: block.content.href } }]
              }
            ];

          return { ...node, attrs: { ...node.attrs, blockId: block.id } };
        })
      : [{ type: 'paragraph' }]
  };
}

function contentToEditor(content: BlockContent, images: Record<string, string>): Node {
  switch (content.type) {
    case 'paragraph':
    case 'segment':
    case 'reference':
      return editorParagraph(content);
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: content.level },
        content: editorInlines(content.inlines)
      };
    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: content.language },
        content: textNode(content.code)
      };
    case 'math':
      return { type: 'documentMath', content: textNode(content.expression) };
    case 'image':
      return editorImage(content, images);
    case 'table':
      return {
        type: 'table',
        content: content.rows.map((row) => ({
          type: 'tableRow',
          content: row.cells.map((cell) => ({
            type: cell.header ? 'tableHeader' : 'tableCell',
            attrs: {
              colspan: cell.colspan ?? 1,
              rowspan: cell.rowspan ?? 1,
              colwidth: cell.colwidth ?? null
            },
            content: cell.paragraphs.map((paragraph) => ({
              type: 'paragraph',
              content: editorInlines(paragraph)
            }))
          }))
        }))
      };
    case 'list_item':
      return editorListBlock(content.items);
  }
}

function editorImage(
  content: Extract<BlockContent, { type: 'image' }>,
  images: Record<string, string>
): Node {
  return {
    type: 'image',
    attrs: {
      sourceId: String(content.sourceId),
      revision: content.revision,
      alt: content.alt,
      src: images[`${content.sourceId}:${content.revision}`] ?? null,
      width: content.width ?? null,
      height: content.height ?? null
    }
  };
}

function editorParagraph(
  content: Extract<BlockContent, { type: 'paragraph' | 'segment' | 'reference' }>
): Node {
  return {
    type: 'paragraph',
    attrs: {
      sourceKind: content.type === 'paragraph' ? null : content.type,
      sourceHref: content.type === 'reference' ? content.href : null
    },
    content: editorInlines(content.inlines)
  };
}

function editorListBlock(items: readonly ListItem[]): Node {
  const content = editorLists(items);

  return content.length === 1 ? content[0]! : { type: 'pageList', content };
}

function editorLists(items: readonly ListItem[]): Node[] {
  const roots: Node[] = [];
  const levels: Array<{ lists: Node[]; list: Node; item: Node }> = [];

  for (const item of items) {
    const previous = levels[item.depth]?.item;

    if (appendContinuation(previous, item)) {
      levels.length = item.depth + 1;
      continue;
    }

    const parent = levels[item.depth - 1];
    const lists = listChildren(parent?.item, roots);
    const type = item.ordered ? 'orderedList' : 'bulletList';
    const level = levels[item.depth];
    let list = level?.lists === lists ? level.list : undefined;

    if (!list || list.type !== type) {
      list = { type, attrs: { start: item.start }, content: [] };
      lists.push(list);
    }

    const node = editorListItem(item);

    list.content!.push(node);
    levels[item.depth] = { lists, list, item: node };
    levels.length = item.depth + 1;
  }

  return roots;
}

function listChildren(parent: Node | undefined, roots: Node[]): Node[] {
  return parent ? (parent.content ??= []) : roots;
}

function appendContinuation(previous: Node | undefined, item: ListItem): boolean {
  if (!item.continuation || !previous) return false;

  previous.content!.push(...editorListItem(item).content!);

  return true;
}

function editorListItem(item: ListItem): Node {
  return {
    type: 'listItem',
    attrs: { itemStart: item.start },
    content: [
      {
        type: 'paragraph',
        attrs: {
          continuation: item.continuation ?? false,
          continuationStart: item.continuation ? item.start : null
        },
        content: editorInlines(item.inlines)
      }
    ]
  };
}

function canonicalInlines(nodes: readonly Node[] = []): Inline[] {
  return nodes.flatMap((node): Inline[] => {
    if (node.type === 'hardBreak') return [{ type: 'break' }];

    if (node.type === 'documentInlineMath') return [{ type: 'math', text: nodeText(node) }];

    if (node.type !== 'text') return canonicalInlines(node.content);

    return [canonicalTextInline(node)];
  });
}

function canonicalTextInline(node: Node): Extract<Inline, { type: 'text' | 'link' }> {
  const formatting = canonicalMarks(node);
  const link = node.marks?.find((mark) => mark.type === 'link');

  if (link) {
    const linked: Extract<Inline, { type: 'link' }> = {
      type: 'link',
      text: node.text ?? '',
      href: String(link.attrs?.href ?? ''),
      ...(formatting.length ? { marks: formatting } : {})
    };

    if (Schema.is(blockContentSchema)({ type: 'paragraph', inlines: [linked] })) return linked;
  }

  return { type: 'text', text: node.text ?? '', marks: formatting };
}

function canonicalMarks(node: Node): TextMark[] {
  return Object.entries(marks)
    .filter(([, name]) => node.marks?.some((mark) => mark.type === name))
    .map(([name]) => name as TextMark);
}

const nodeText = (node: Node): string => node.text ?? (node.content ?? []).map(nodeText).join('');

function canonicalList(node: Node, depth = 0): ListItem[] {
  let start = Number(node.attrs?.start ?? 1);

  return (node.content ?? []).flatMap((item) => {
    if (item.type !== 'listItem') return [];

    start = Number(item.attrs?.itemStart ?? start);
    const items = canonicalListItem(node, item, start, depth);

    start++;

    return items;
  });
}

function canonicalListItem(list: Node, item: Node, start: number, depth: number): ListItem[] {
  return (item.content ?? []).flatMap((child) => {
    if (child.type === 'bulletList' || child.type === 'orderedList')
      return canonicalList(child, depth + 1);

    return [
      {
        depth,
        ordered: list.type === 'orderedList',
        start: child.attrs?.continuationStart ?? start,
        ...(child.attrs?.continuation ? { continuation: true } : {}),
        inlines: canonicalInlines(child.content)
      }
    ];
  });
}

type ContentReader = (node: Node) => BlockContent;

function readParagraph(node: Node): BlockContent {
  const inlines = canonicalInlines(node.content);

  if (node.attrs?.sourceKind === 'reference')
    return { type: 'reference', href: node.attrs.sourceHref, inlines };

  return { type: node.attrs?.sourceKind === 'segment' ? 'segment' : 'paragraph', inlines };
}

type TableContent = Extract<BlockContent, { type: 'table' }>;

function cellDimensions(attributes: NonNullable<Node['attrs']>) {
  const result: { colspan?: number; rowspan?: number; colwidth?: number[] } = {};

  if (Number(attributes.colspan) > 1) result.colspan = Number(attributes.colspan);

  if (Number(attributes.rowspan) > 1) result.rowspan = Number(attributes.rowspan);

  if (attributes.colwidth) result.colwidth = attributes.colwidth;

  return result;
}

function readCell(cell: Node): TableContent['rows'][number]['cells'][number] {
  return {
    header: cell.type === 'tableHeader',
    ...cellDimensions(cell.attrs ?? {}),
    paragraphs: (cell.content ?? []).map((paragraph) => canonicalInlines(paragraph.content))
  };
}

function readTable(node: Node): BlockContent {
  return {
    type: 'table',
    rows: (node.content ?? []).map((row) => ({ cells: (row.content ?? []).map(readCell) }))
  };
}

function imageDimensions(attributes: NonNullable<Node['attrs']>) {
  const result: { width?: number; height?: number } = {};

  if (Number(attributes.width) > 0) result.width = Math.round(Number(attributes.width));

  if (Number(attributes.height) > 0) result.height = Math.round(Number(attributes.height));

  return result;
}

function readImage(node: Node): BlockContent {
  const attributes = node.attrs ?? {};

  return {
    type: 'image',
    sourceId: Schema.decodeUnknownSync(sourceIdSchema)(BigInt(attributes.sourceId)),
    revision: attributes.revision,
    alt: attributes.alt ?? '',
    ...imageDimensions(attributes)
  };
}

const contentReaders: Record<string, ContentReader> = {
  paragraph: readParagraph,
  heading: (node) => ({
    type: 'heading',
    level: Number(node.attrs?.level ?? 1),
    inlines: canonicalInlines(node.content)
  }),
  codeBlock: (node) => ({
    type: 'code',
    code: nodeText(node),
    language: node.attrs?.language ?? null
  }),
  documentMath: (node) => ({ type: 'math', expression: nodeText(node) }),
  image: readImage,
  table: readTable,
  pageList: (node) => ({
    type: 'list_item',
    items: (node.content ?? []).flatMap((list) => canonicalList(list))
  }),
  bulletList: (node) => ({ type: 'list_item', items: canonicalList(node) }),
  orderedList: (node) => ({ type: 'list_item', items: canonicalList(node) })
};

function editorContent(node: Node): BlockContent {
  return (contentReaders[node.type ?? 'paragraph'] ?? readParagraph)(node);
}

/** Carries retained metadata/anchors through edits; splits and pasted duplicates receive fresh IDs. */
export function editorToDocument(editor: Node, original: EditableDocument): EditableDocument {
  const seen = new Set<string>();
  const originals = new Map(original.blocks.map((block) => [block.id, block]));

  return {
    ...original,
    blocks: (editor.content ?? []).map((node) => {
      const previous = originals.get(node.attrs?.blockId);
      const retained = previous && !seen.has(previous.id) ? previous : undefined;
      const content = editorContent(node);

      if (retained) seen.add(retained.id);

      return createBlock(
        Schema.decodeUnknownSync(blockContentSchema)(content),
        retained?.anchor,
        retained?.id
      );
    })
  };
}
