import type { BlockContent, Inline, documentSchema } from '@study/contracts/sources/schemas';
import { Fragment, createElement } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';

function Inlines({ items }: { items: readonly Inline[] }) {
  return items.map((item, index) => {
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
    return <Fragment key={index}>{child}</Fragment>;
  });
}

// List preorder is reconstructed into nested semantic lists, retaining explicit numbering.
function List({ items }: { items: Extract<BlockContent, { type: 'list_item' }>['items'] }) {
  type Item = (typeof items)[number];
  type Part = { type: 'paragraph'; inlines: readonly Inline[] } | { type: 'list'; nodes: Node[] };
  type Node = { item: Item; parts: Part[] };
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const item of items) {
    if (item.continuation && stack[item.depth]) {
      stack[item.depth]!.parts.push({
        type: 'paragraph',
        inlines: item.inlines
      });
      stack.length = item.depth + 1;
      continue;
    }
    const node: Node = {
      item,
      parts: [{ type: 'paragraph', inlines: item.inlines }]
    };
    const parent = stack[item.depth - 1];
    if (item.depth > 0 && parent) {
      const last = parent.parts.at(-1);
      if (last?.type === 'list') last.nodes.push(node);
      else parent.parts.push({ type: 'list', nodes: [node] });
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
      const children = nodes.slice(start, offset).map((node, index) => (
        <li key={start + index} value={ordered ? node.item.start : undefined}>
          {node.parts.map((part, i) =>
            part.type === 'paragraph' ? (
              <p key={i}>
                <Inlines items={part.inlines} />
              </p>
            ) : (
              <Fragment key={i}>{groups(part.nodes)}</Fragment>
            )
          )}
        </li>
      ));
      result.push(
        ordered ? (
          <ol key={start} start={nodes[start]!.item.start}>
            {children}
          </ol>
        ) : (
          <ul key={start}>{children}</ul>
        )
      );
    }
    return result;
  }
  return groups(roots);
}

function Content({ content, image }: { content: BlockContent; image?: string }) {
  const { t } = useI18n();
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
      return (
        <pre>
          <code data-language={content.language ?? undefined}>{content.code}</code>
        </pre>
      );
    case 'math':
      return (
        <pre className="reader-math">
          <code>{content.expression}</code>
        </pre>
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
      return (
        <figure>
          {image ? <img src={image} alt={content.alt} /> : <p>{t('ReaderImageUnavailable')}</p>}
          <figcaption>{content.alt}</figcaption>
        </figure>
      );
    case 'table':
      return (
        <div className="reader-table" tabIndex={0} role="region" aria-label={t('ReaderTable')}>
          <table>
            <tbody>
              {content.rows.map((row, i) => (
                <tr key={i}>
                  {row.cells.map((cell, j) =>
                    createElement(
                      cell.header ? 'th' : 'td',
                      { key: j },
                      cell.paragraphs.map((paragraph, k) => (
                        <p key={k}>
                          <Inlines items={paragraph} />
                        </p>
                      ))
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
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
    <article className="material-prose">
      {document.meta.omissions.length > 0 && (
        <aside className="reader-notice">
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
        </aside>
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
    </article>
  );
}
