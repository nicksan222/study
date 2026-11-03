import { sourceIdSchema } from '@study/contracts/ids';
import type { materialDocumentSchema } from '@study/contracts/materials/schemas';
import { createBlock } from '@study/contracts/sources/document';
import type { BlockContent, Inline } from '@study/contracts/sources/schemas';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import type { StructuredEditorValue as Node } from '@study/ui/structured-editor';
import { Schema } from 'effect';

export type EditableDocument = typeof materialDocumentSchema.Type;

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
            ? [{ type: 'link', attrs: { href: inline.href } }]
            : inline.marks.map((mark) => ({ type: marks[mark] }))
      }
    ];
  });
}

/** Retains source block identity separately from the editor's transient node positions. */
export function documentToEditor(document: EditableDocument): Node {
  return {
    type: 'doc',
    content: document.blocks.length
      ? document.blocks.map((block) => {
          const node = contentToEditor(block.content);

          return { ...node, attrs: { ...node.attrs, blockId: block.id } };
        })
      : [{ type: 'paragraph' }]
  };
}

function contentToEditor(content: BlockContent): Node {
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
      return {
        type: 'documentImage',
        attrs: { sourceId: String(content.sourceId), revision: content.revision, alt: content.alt }
      };
    case 'table':
      return {
        type: 'documentTable',
        content: content.rows.map((row) => ({
          type: 'documentRow',
          content: row.cells.map((cell) => ({
            type: 'documentCell',
            attrs: { header: cell.header },
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

  return content.length === 1 ? content[0]! : { type: 'documentList', content };
}

function editorLists(items: readonly ListItem[]): Node[] {
  const roots: Node[] = [];
  const levels: Array<{ lists: Node[]; list: Node; item: Node }> = [];

  for (const item of items) {
    const lists = item.depth === 0 ? roots : (levels[item.depth - 1]!.item.content ??= []);
    const type = item.ordered ? 'orderedList' : 'bulletList';
    let list = levels[item.depth]?.lists === lists ? levels[item.depth]?.list : undefined;

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

function editorListItem(item: ListItem): Node {
  return {
    type: 'listItem',
    attrs: { itemStart: item.start },
    content: [
      {
        type: 'paragraph',
        attrs: { continuation: item.continuation ?? false },
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

    const link = node.marks?.find((mark) => mark.type === 'link');

    if (link) {
      const linked: BlockContent = {
        type: 'paragraph',
        inlines: [{ type: 'link', text: node.text ?? '', href: String(link.attrs?.href ?? '') }]
      };

      if (Schema.is(blockContentSchema)(linked)) return [...linked.inlines];
    }

    return [
      {
        type: 'text',
        text: node.text ?? '',
        marks: Object.entries(marks)
          .filter(([, name]) => node.marks?.some((mark) => mark.type === name))
          .map(([name]) => name as TextMark)
      }
    ];
  });
}

const nodeText = (node: Node): string => node.text ?? (node.content ?? []).map(nodeText).join('');

function canonicalList(node: Node, depth = 0): ListItem[] {
  return (node.content ?? []).flatMap((item, index) =>
    item.type === 'listItem' ? canonicalListItem(node, item, index, depth) : []
  );
}

function canonicalListItem(list: Node, item: Node, index: number, depth: number): ListItem[] {
  return (item.content ?? []).flatMap((child) => {
    if (child.type === 'bulletList' || child.type === 'orderedList')
      return canonicalList(child, depth + 1);

    return [
      {
        depth,
        ordered: list.type === 'orderedList',
        start: listItemStart(list, item, index),
        ...(child.attrs?.continuation ? { continuation: true } : {}),
        inlines: canonicalInlines(child.content)
      }
    ];
  });
}

function listItemStart(list: Node, item: Node, index: number): number {
  return Number(item.attrs?.itemStart ?? Number(list.attrs?.start ?? 1) + index);
}

type ContentReader = (node: Node) => BlockContent;

function readParagraph(node: Node): BlockContent {
  const inlines = canonicalInlines(node.content);

  if (node.attrs?.sourceKind === 'reference')
    return { type: 'reference', href: node.attrs.sourceHref, inlines };

  return { type: node.attrs?.sourceKind === 'segment' ? 'segment' : 'paragraph', inlines };
}

function readTable(node: Node): BlockContent {
  return {
    type: 'table',
    rows: (node.content ?? []).map((row) => ({
      cells: (row.content ?? []).map((cell) => ({
        header: !!cell.attrs?.header,
        paragraphs: (cell.content ?? []).map((paragraph) => canonicalInlines(paragraph.content))
      }))
    }))
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
  documentImage: (node) => ({
    type: 'image',
    sourceId: Schema.decodeUnknownSync(sourceIdSchema)(BigInt(node.attrs?.sourceId)),
    revision: node.attrs?.revision,
    alt: node.attrs?.alt ?? ''
  }),
  documentTable: readTable,
  documentList: (node) => ({
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
