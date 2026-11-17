import { createBlock, canonicalText } from '@study/contracts';
import type { BlockContent, Inline, documentSchema } from '@study/contracts';
import { Button, DocumentEditing, Field, Textarea } from '@study/ui';
import { createContext, useContext } from 'react';

import { DictationTextarea } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

type Document = typeof documentSchema.Type;

const BlockDictationDisabled = createContext(false);

function InlineFields({
  items,
  change
}: {
  items: readonly Inline[];
  change: (items: Inline[]) => void;
}) {
  const { t } = useI18n();
  const disabled = useContext(BlockDictationDisabled);

  return positions(items).map(({ value: item, position: index, key }) =>
    item.type === 'break' ? (
      <br key={key} />
    ) : (
      <DictationTextarea
        key={key}
        label={
          <>
            {' '}
            {t('PageText')} {index + 1}{' '}
          </>
        }
        disabled={disabled}
        value={item.text}
        onValueChange={(text) =>
          change(items.map((value, i) => (i === index ? { ...item, text } : value)))
        }
      />
    )
  );
}

function ContentFields({
  content,
  change
}: {
  content: BlockContent;
  change: (content: BlockContent) => void;
}) {
  const { t } = useI18n();

  if ('inlines' in content)
    return (
      <InlineFields items={content.inlines} change={(inlines) => change({ ...content, inlines })} />
    );

  if (content.type === 'list_item')
    return positions(content.items).map(({ value: item, position: index, key }) => (
      <div key={key}>
        <InlineFields
          items={item.inlines}
          change={(inlines) =>
            change({
              ...content,
              items: content.items.map((value, i) => (i === index ? { ...value, inlines } : value))
            })
          }
        />
      </div>
    ));

  if (content.type === 'table') return <TableFields content={content} change={change} />;

  if (content.type === 'code')
    return (
      <Field label={<> {t('PageCode')} </>}>
        <Textarea
          font="mono"
          value={content.code}
          onChange={(event) => change({ ...content, code: event.target.value })}
        />
      </Field>
    );

  if (content.type === 'math')
    return (
      <Field label={<> {t('PageMath')} </>}>
        <Textarea
          font="mono"
          value={content.expression}
          onChange={(event) => change({ ...content, expression: event.target.value })}
        />
      </Field>
    );

  return (
    <Field label={<> {t('PageImageAlt')} </>}>
      <Textarea
        value={content.alt}
        onChange={(event) => change({ ...content, alt: event.target.value })}
      />
    </Field>
  );
}

export function BlockEditor({
  document,
  change,
  disabled,
  targetKey
}: {
  document: Document;
  change: (document: Document) => void;
  disabled?: boolean;
  targetKey?: string;
}) {
  const { t } = useI18n();

  return (
    <BlockDictationDisabled value={disabled === true}>
      <DocumentEditing.Blocks disabled={disabled}>
        <p>{t('PageStructurePreserved')}</p>
        {document.blocks.map((block, index) => (
          <fieldset key={`${targetKey ?? 'document'}:${block.id}`}>
            <legend>
              {t('PageBlock')} {index + 1}
            </legend>
            <ContentFields
              content={block.content}
              change={(content) =>
                change({
                  ...document,
                  blocks: document.blocks.map((value) =>
                    value.id === block.id
                      ? { ...value, content, text: canonicalText(content) }
                      : value
                  )
                })
              }
            />
            <DocumentEditing.BlockActions>
              <Button
                variant="ghost"
                disabled={index === 0}
                onClick={() => {
                  const blocks = [...document.blocks];

                  [blocks[index - 1], blocks[index]] = [blocks[index]!, blocks[index - 1]!];
                  change({ ...document, blocks });
                }}
              >
                {t('PageMoveUp')}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  change({
                    ...document,
                    blocks: document.blocks.filter((value) => value.id !== block.id)
                  })
                }
              >
                {t('PageRemoveBlock')}
              </Button>
            </DocumentEditing.BlockActions>
          </fieldset>
        ))}
        <Button
          variant="ghost"
          onClick={() =>
            change({
              ...document,
              blocks: [
                ...document.blocks,
                createBlock({ type: 'paragraph', inlines: [{ type: 'text', text: '', marks: [] }] })
              ]
            })
          }
        >
          {t('PageAddParagraph')}
        </Button>
      </DocumentEditing.Blocks>
    </BlockDictationDisabled>
  );
}

export const blankDocument = (): Document => ({
  blocks: [],
  meta: {
    extractor: null,
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false,
    omissions: []
  }
});

/** An independent material owns fresh authored blocks; editing an existing one retains IDs. */
export function authoredCopy(document: Document): Document {
  return {
    ...structuredClone(document),
    blocks: document.blocks.map((block) => createBlock(block.content))
  };
}

type TableContent = Extract<BlockContent, { type: 'table' }>;

type Cell = TableContent['rows'][number]['cells'][number];

// Inline segments and table coordinates have no insert/reorder controls; their positions remain stable while editing.
function positions<T>(values: readonly T[]) {
  return values.map((value, position) => ({ value, position, key: String(position) }));
}

function replaceAt<T>(values: readonly T[], position: number, replacement: T) {
  return values.map((value, index) => (index === position ? replacement : value));
}

function tableParagraph(
  content: TableContent,
  row: number,
  column: number,
  paragraph: number,
  inlines: Inline[]
): TableContent {
  const originalRow = content.rows[row]!;
  const originalCell = originalRow.cells[column]!;

  return {
    ...content,
    rows: replaceAt(content.rows, row, {
      ...originalRow,
      cells: replaceAt(originalRow.cells, column, {
        ...originalCell,
        paragraphs: replaceAt(originalCell.paragraphs, paragraph, inlines)
      })
    })
  };
}

function TableFields({
  content,
  change
}: {
  content: TableContent;
  change: (content: BlockContent) => void;
}) {
  return positions(content.rows).map(({ value: row, position: r, key }) => (
    <div key={key}>
      {positions(row.cells).map(({ value: cell, position: c, key: cellKey }) => (
        <TableCell
          key={cellKey}
          cell={cell}
          row={r}
          column={c}
          change={(p, inlines) => change(tableParagraph(content, r, c, p, inlines))}
        />
      ))}
    </div>
  ));
}

function TableCell({
  cell,
  row,
  column,
  change
}: {
  cell: Cell;
  row: number;
  column: number;
  change: (paragraph: number, inlines: Inline[]) => void;
}) {
  const { t } = useI18n();

  return (
    <fieldset>
      <legend>
        {t('PageCell')} {row + 1} · {column + 1}
      </legend>
      {positions(cell.paragraphs).map(({ value: paragraph, position, key }) => (
        <InlineFields key={key} items={paragraph} change={(inlines) => change(position, inlines)} />
      ))}
    </fieldset>
  );
}
