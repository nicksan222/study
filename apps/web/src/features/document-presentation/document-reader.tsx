import type { BlockContent, Inline, documentSchema } from '@study/contracts/sources/schemas';
import { MaterialLibrary } from '@study/ui/material-library';
import { Fragment, createElement } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';

function Inlines({ items }: { items: readonly Inline[] }) {
  return keyed(items).map(({ value: item, key }) => {
    let child: ReactNode;

    if (item.type === 'break') child = <br />;
    else if (item.type === 'link')
      child = (
        <a href={item.href} target="_blank" rel="noreferrer">
          {item.text}
        </a>
      );
    else if (item.type === 'math') child = <code>{item.text}</code>;
    else {
      child = item.text;

      for (const mark of item.marks) {
        const tag = {
          strong: 'strong',
          emphasis: 'em',
          code: 'code',
          strike: 's',
          subscript: 'sub',
          superscript: 'sup'
        }[mark];

        child = createElement(tag, null, child);
      }
    }

    return <Fragment key={key}>{child}</Fragment>;
  });
}

// List preorder is reconstructed into nested semantic lists, retaining explicit numbering.
function List({ items }: { items: Extract<BlockContent, { type: 'list_item' }>['items'] }) {
  type Item = (typeof items)[number];

  type Part =
    | { key: string; type: 'paragraph'; inlines: readonly Inline[] }
    | { key: string; type: 'list'; nodes: Node[] };

  type Node = { key: string; item: Item; parts: Part[] };

  const roots: Node[] = [];
  const stack: Node[] = [];

  for (const { value: item, key } of keyed(items)) {
    if (item.continuation && stack[item.depth]) {
      stack[item.depth]!.parts.push({
        key,
        type: 'paragraph',
        inlines: item.inlines
      });
      stack.length = item.depth + 1;
      continue;
    }

    const node: Node = {
      key,
      item,
      parts: [{ key, type: 'paragraph', inlines: item.inlines }]
    };
    const parent = stack[item.depth - 1];

    if (item.depth > 0 && parent) {
      const last = parent.parts.at(-1);

      if (last?.type === 'list') last.nodes.push(node);
      else parent.parts.push({ key: node.key + ':list', type: 'list', nodes: [node] });
    } else roots.push(node);

    stack[item.depth] = node;
    stack.length = item.depth + 1;
  }

  function groups(nodes: Node[]): ReactNode {
    const result: ReactNode[] = [];
    let offset = 0;

    while (offset < nodes.length) {
      const start = offset;
      const ordered = nodes[start]!.item.ordered;

      while (offset < nodes.length && nodes[offset]!.item.ordered === ordered) offset++;

      const children = nodes.slice(start, offset).map((node) => (
        <li key={node.key} value={ordered ? node.item.start : undefined}>
          {node.parts.map((part) =>
            part.type === 'paragraph' ? (
              <p key={part.key}>
                <Inlines items={part.inlines} />
              </p>
            ) : (
              <Fragment key={part.key}>{groups(part.nodes)}</Fragment>
            )
          )}
        </li>
      ));

      result.push(
        ordered ? (
          <ol key={nodes[start]!.key} start={nodes[start]!.item.start}>
            {children}
          </ol>
        ) : (
          <ul key={nodes[start]!.key}>{children}</ul>
        )
      );
    }

    return result;
  }

  return groups(roots);
}

function Content({ content, image }: { content: BlockContent; image?: string }) {
  switch (content.type) {
    case 'paragraph':
    case 'segment':
      return (
        <p>
          <Inlines items={content.inlines} />
        </p>
      );
    case 'heading':
      return createElement(`h${content.level}`, null, <Inlines items={content.inlines} />);
    case 'list_item':
      return <List items={content.items} />;
    case 'code':
      return <CodeContent content={content} />;
    case 'math':
      return (
        <MaterialLibrary.Math>
          <code>{content.expression}</code>
        </MaterialLibrary.Math>
      );
    case 'reference':
      return (
        <p>
          <Inlines items={content.inlines} />
          <br />
          <a href={content.href} target="_blank" rel="noreferrer">
            {content.href}
          </a>
        </p>
      );
    case 'image':
      return <ImageContent content={content} image={image} />;
    case 'table':
      return <TableContent content={content} />;
  }
}

export function DocumentReader({
  document,
  images = {},
  renderImage
}: {
  document: typeof documentSchema.Type;
  images?: Record<string, string>;
  renderImage?: (block: (typeof documentSchema.Type.blocks)[number]) => ReactNode;
}) {
  const { t } = useI18n();

  return (
    <MaterialLibrary.Prose>
      {document.meta.omissions.length > 0 && (
        <MaterialLibrary.NoticeAside>
          {t('ReaderOmissions')}
          <ul>
            {document.meta.omissions.map((omission) => (
              <li key={omission}>
                {t(
                  (
                    {
                      formatting: 'ReaderOmitFormatting',
                      nested_table: 'ReaderOmitNestedTable',
                      embedded_media: 'ReaderOmitMedia',
                      layout: 'ReaderOmitLayout',
                      provider_structure: 'ReaderOmitProvider',
                      structure: 'ReaderOmitStructure',
                      unsupported_markup: 'ReaderOmitMarkup'
                    } as const
                  )[omission]
                )}
              </li>
            ))}
          </ul>
        </MaterialLibrary.NoticeAside>
      )}
      {document.blocks.length === 0 && <p>{t('ReaderNoText')}</p>}
      {document.blocks.map((block) => (
        <section id={`block-${block.id}`} key={block.id} data-block-id={block.id}>
          {block.content.type === 'image' && renderImage ? (
            renderImage(block)
          ) : (
            <Content content={block.content} image={images[block.id]} />
          )}
        </section>
      ))}
    </MaterialLibrary.Prose>
  );
}

function keyed<T>(items: readonly T[]) {
  const seen = new Map<string, number>();

  return items.map((value) => {
    const content = JSON.stringify(value);
    const occurrence = seen.get(content) ?? 0;

    seen.set(content, occurrence + 1);

    return { key: content + ':' + occurrence, value };
  });
}

function ImageContent({
  content,
  image
}: {
  content: Extract<BlockContent, { type: 'image' }>;
  image?: string;
}) {
  const { t } = useI18n();

  return (
    <figure>
      {image ? <img src={image} alt={content.alt} /> : <p>{t('ReaderImageUnavailable')}</p>}
      <figcaption>{content.alt}</figcaption>
    </figure>
  );
}

type TableRow = Extract<BlockContent, { type: 'table' }>['rows'][number];

function TableContent({ content }: { content: Extract<BlockContent, { type: 'table' }> }) {
  const { t } = useI18n();

  return (
    <MaterialLibrary.Table tabIndex={0} role="region" aria-label={t('ReaderTable')}>
      <table>
        <tbody>
          {keyed(content.rows).map(({ value: row, key }) => (
            <DocumentRow key={key} row={row} />
          ))}
        </tbody>
      </table>
    </MaterialLibrary.Table>
  );
}

function DocumentRow({ row }: { row: TableRow }) {
  return (
    <tr>
      {keyed(row.cells).map(({ value: cell, key }) => (
        <DocumentCell key={key} cell={cell} />
      ))}
    </tr>
  );
}

function DocumentCell({ cell }: { cell: TableRow['cells'][number] }) {
  return createElement(
    cell.header ? 'th' : 'td',
    null,
    keyed(cell.paragraphs).map(({ value: paragraph, key }) => (
      <p key={key}>
        <Inlines items={paragraph} />
      </p>
    ))
  );
}

function CodeContent({ content }: { content: Extract<BlockContent, { type: 'code' }> }) {
  return (
    <pre>
      <code data-language={content.language ?? undefined}>{content.code}</code>
    </pre>
  );
}
