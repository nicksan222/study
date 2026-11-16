import {
  sourceIdSchema,
  defaultWorkspacePreferences,
  blockIdSchema,
  canonicalText
} from '@study/contracts';
import type { BlockContent, documentSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from '#client/lib/i18n.tsx';

import type * as __MockType1 from '../document-presentation';

let LanguageProvider: typeof __MockType0.LanguageProvider;

let DocumentReader: typeof __MockType1.DocumentReader;

const text = (value: string) => [{ type: 'text' as const, text: value, marks: [] }];

function document(contents: BlockContent[]): typeof documentSchema.Type {
  return {
    blocks: contents.map((content, index) => ({
      id: Schema.decodeUnknownSync(blockIdSchema)(`b${index}`),
      kind: content.type,
      content,
      text: canonicalText(content),
      anchor: { type: 'authored' }
    })),
    meta: {
      extractor: null,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: ['nested_table']
    }
  };
}

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
    useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, readerFontSize: 22 })
  }));
  const __mockModule0 = await import('#client/lib/i18n.tsx');

  LanguageProvider = __mockModule0.LanguageProvider;
  const __mockModule1 = await import('../document-presentation');

  DocumentReader = __mockModule1.DocumentReader;
});

test.unit.stable(
  'preserves heading, inline marks, table paragraphs, code, list nesting and stable block anchors',
  ({ render, expect, screen }) => {
    const { container } = render(
      <DocumentReader
        document={document([
          { type: 'heading', level: 2, inlines: text('A heading') },
          {
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'Important', marks: ['strong', 'emphasis'] }]
          },
          {
            type: 'table',
            rows: [
              {
                cells: [
                  {
                    header: true,
                    paragraphs: [text('First paragraph'), text('Second paragraph')]
                  }
                ]
              }
            ]
          },
          {
            type: 'code',
            code: '<script>not executed</script>',
            language: 'html'
          },
          {
            type: 'list_item',
            items: [
              { depth: 0, ordered: true, start: 3, inlines: text('Third') },
              { depth: 1, ordered: false, start: 1, inlines: text('Nested') },
              {
                depth: 1,
                ordered: false,
                start: 1,
                continuation: true,
                inlines: text('Continuation')
              }
            ]
          }
        ])}
      />
    );

    expect(screen.getByRole('article')).toHaveStyle({ fontSize: '22px' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('A heading');
    expect(container.querySelector('em strong')).toHaveTextContent('Important');
    expect(container.querySelector('th')?.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre code')).toHaveTextContent('<script>not executed</script>');
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelector('ol > li > ul > li')?.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelector('#block-b0')).toBeInTheDocument();
  }
);

test.unit.stable(
  'discloses omissions and unavailable exact image revisions in both languages without requesting current bytes',
  ({ render, expect, screen }) => {
    const image: BlockContent = {
      type: 'image',
      sourceId: Schema.decodeUnknownSync(sourceIdSchema)(1n),
      revision: 2,
      alt: 'Historical figure'
    };
    const { container, rerender } = render(
      <LanguageProvider locale="english">
        <DocumentReader document={document([image])} />
      </LanguageProvider>
    );

    expect(screen.getByText(catalogs.english.ReaderImageUnavailable)).toBeInTheDocument();
    expect(screen.getByText(catalogs.english.ReaderOmitNestedTable)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    rerender(
      <LanguageProvider locale="italian">
        <DocumentReader document={document([image])} />
      </LanguageProvider>
    );
    expect(screen.getByText(catalogs.italian.ReaderImageUnavailable)).toBeInTheDocument();
    expect(screen.getByText('Historical figure')).toBeInTheDocument();
  }
);

test.unit.stable(
  'keeps parent continuations after intervening nested list content',
  ({ render, expect }) => {
    const { container } = render(
      <DocumentReader
        document={document([
          {
            type: 'list_item',
            items: [
              { depth: 0, ordered: false, start: 1, inlines: text('Before') },
              { depth: 1, ordered: true, start: 4, inlines: text('Child') },
              {
                depth: 0,
                ordered: false,
                start: 1,
                continuation: true,
                inlines: text('After')
              },
              {
                depth: 1,
                ordered: false,
                start: 1,
                inlines: text('Later child')
              }
            ]
          }
        ])}
      />
    );
    const item = container.querySelector('.material-prose section > ul > li');

    expect(Array.from(item?.children ?? []).map((child) => child.textContent)).toEqual([
      'Before',
      'Child',
      'After',
      'Later child'
    ]);
    expect(item?.querySelector('ol')).toHaveAttribute('start', '4');
  }
);
