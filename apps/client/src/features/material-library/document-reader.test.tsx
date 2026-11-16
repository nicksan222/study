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

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { DocumentReader } from '../document-presentation';

test.mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
  useWorkspacePreferences: () => ({ ...defaultWorkspacePreferences, readerFontSize: 22 })
}));

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

test.stable(
  'preserves heading, inline marks, table paragraphs, code, list nesting and stable block anchors',
  () => {
    const { container } = test.render(
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

    test.expect(test.screen.getByRole('article')).toHaveStyle({ fontSize: '22px' });
    test.expect(test.screen.getByRole('heading', { level: 2 })).toHaveTextContent('A heading');
    test.expect(container.querySelector('em strong')).toHaveTextContent('Important');
    test.expect(container.querySelector('th')?.querySelectorAll('p')).toHaveLength(2);
    test.expect(container.querySelector('script')).toBeNull();
    test
      .expect(container.querySelector('pre code'))
      .toHaveTextContent('<script>not executed</script>');
    test.expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    test
      .expect(container.querySelector('ol > li > ul > li')?.querySelectorAll('p'))
      .toHaveLength(2);
    test.expect(container.querySelector('#block-b0')).toBeInTheDocument();
  }
);

test.stable(
  'discloses omissions and unavailable exact image revisions in both languages without requesting current bytes',
  () => {
    const image: BlockContent = {
      type: 'image',
      sourceId: Schema.decodeUnknownSync(sourceIdSchema)(1n),
      revision: 2,
      alt: 'Historical figure'
    };
    const { container, rerender } = test.render(
      <LanguageProvider locale="english">
        <DocumentReader document={document([image])} />
      </LanguageProvider>
    );

    test.expect(test.screen.getByText(catalogs.english.ReaderImageUnavailable)).toBeInTheDocument();
    test.expect(test.screen.getByText(catalogs.english.ReaderOmitNestedTable)).toBeInTheDocument();
    test.expect(container.querySelector('img')).toBeNull();
    rerender(
      <LanguageProvider locale="italian">
        <DocumentReader document={document([image])} />
      </LanguageProvider>
    );
    test.expect(test.screen.getByText(catalogs.italian.ReaderImageUnavailable)).toBeInTheDocument();
    test.expect(test.screen.getByText('Historical figure')).toBeInTheDocument();
  }
);

test.stable('keeps parent continuations after intervening nested list content', () => {
  const { container } = test.render(
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

  test
    .expect(Array.from(item?.children ?? []).map((child) => child.textContent))
    .toEqual(['Before', 'Child', 'After', 'Later child']);
  test.expect(item?.querySelector('ol')).toHaveAttribute('start', '4');
});
