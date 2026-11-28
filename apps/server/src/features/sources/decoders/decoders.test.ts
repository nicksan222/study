import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks source decoder behavior for text and PDF inputs, including document block   │
 * │ anchors.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises text decoding preserves UTF-8 byte anchors and markdown fences.              │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Calls decoder modules directly and keeps ingestion workflows outside these focused       │
 * │ format tests.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import fc from 'fast-check';

import { decodePdf } from '#server/features/sources/decoders/pdf';
import { decodeText } from '#server/features/sources/decoders/text';

const bytes = (value: string) => new TextEncoder().encode(value);

test.unit.stable('text decoding preserves UTF-8 byte anchors and markdown fences', ({ expect }) => {
  const result = decodeText({
    bytes: bytes('# Caffè\n\n```ts\nline\n\nmore\n```\n'),
    kind: 'text',
    mime: 'text/markdown'
  });

  expect(result.blocks.map((block) => block.kind)).toStrictEqual(['heading', 'code']);
  expect(result.blocks[1].anchor).toStrictEqual({
    type: 'text',
    lineStart: 3,
    lineEnd: 7,
    start: 10,
    end: 31
  });
  expect(() =>
    decodeText({ bytes: new Uint8Array([255]), kind: 'text', mime: 'text/plain' })
  ).toThrow(expect.objectContaining({ kind: 'invalid_input' }));
});

test.unit.stable(
  'PDF decoding validates and counts pages',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const fixture = await Bun.file(new URL('./fixtures/two-pages.pdf', import.meta.url)).bytes();

    assert.strictEqual(await decodePdf(fixture), 2);
    await expect(decodePdf(bytes('not a PDF'))).rejects.toMatchObject({ kind: 'invalid_input' });
  }
);

test.unit.stable(
  'vision transcription preserves page anchors and rejects incomplete or reordered pages',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { visionDocument } = await import('#server/features/sources/decoders/vision');
    const pages = [
      { page: 1, blocks: [{ kind: 'heading' as const, text: 'First' }] },
      { page: 2, blocks: [{ kind: 'paragraph' as const, text: 'Second' }] }
    ];
    const document = visionDocument(pages, 2);

    expect(document.blocks.map((block) => block.anchor)).toStrictEqual([
      { type: 'page', page: 1 },
      { type: 'page', page: 2 }
    ]);
    assert.strictEqual(document.meta.pageCount, 2);
    expect(document.meta.omissions).toStrictEqual([
      'provider_structure',
      'layout',
      'embedded_media'
    ]);
    expect(() => visionDocument(pages.slice(0, 1), 2)).toThrow(
      expect.objectContaining({ kind: 'invalid_input' })
    );
    expect(() => visionDocument([...pages].reverse(), 2)).toThrow(
      expect.objectContaining({ kind: 'invalid_input' })
    );
  }
);

test.unit.stable(
  'HTML extracts visible content and preserves URL fragments',
  async ({ expect }) => {
    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const document = decodeHtml({
      bytes: bytes(
        '<header>hidden</header><main><h1 id="top">Title</h1><p>Body &amp; detail</p><nav>menu</nav><style>bad</style><script>bad</script></main>'
      ),
      url: 'https://example.test/'
    });

    expect(document.blocks.map((block) => block.text)).toStrictEqual(['Title', 'Body & detail']);
    expect(document.blocks[0].anchor).toStrictEqual({
      type: 'url',
      url: 'https://example.test/',
      fragment: 'top'
    });
    expect(
      decodeHtml({
        bytes: bytes(
          '<main><div>Intro <b>detail</b></div><ul><li>Parent<ul><li>Child</li></ul>After</li></ul></main>'
        )
      }).blocks.map((block) => [block.kind, block.text])
    ).toStrictEqual([
      ['paragraph', 'Intro detail'],
      ['list_item', 'Parent\nChild\nAfter']
    ]);

    expect(
      decodeHtml({ bytes: bytes('<main><p>Attachment</p></main>') }).blocks[0].anchor
    ).toStrictEqual({ type: 'paragraph', index: 1 });
  }
);

test.unit.stable(
  'Office decoders preserve structures and reject malformed or oversized archives',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { decodeOffice } = await import('#server/features/sources/decoders/office');
    const fixture = (name: string) =>
      Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).bytes();

    for (const [name, kind, expected] of [
      ['sample.docx', 'document', ['Heading', 'First paragraph']],
      ['table.docx', 'document', ['Before', 'Left | Right', 'After']],
      [
        'nested-tables.docx',
        'document',
        ['Before', 'Inner A | Inner B\nInner C', 'After | Outer second']
      ],
      [
        'wrapped.docx',
        'document',
        ['Wrapped document', 'Before Wrapped', 'Nested', 'Wrapped after After | Other cell']
      ],
      ['sample.pptx', 'slides', ['Slide 2', 'Speaker notes', 'Slide 1']],
      ['interleaved.pptx', 'slides', ['Before', 'Cell', 'After']]
    ] as const) {
      const doc = await decodeOffice({ kind, bytes: await fixture(name) });

      expect(
        doc.blocks.map((block) => block.text),
        name
      ).toStrictEqual(expected);
    }

    const slides = await decodeOffice({ kind: 'slides', bytes: await fixture('sample.pptx') });

    assert.strictEqual(slides.meta.pageCount, 2);
    expect(slides.blocks.map((block) => block.anchor)).toStrictEqual([
      { type: 'slide', index: 1 },
      { type: 'slide', index: 1 },
      { type: 'slide', index: 2 }
    ]);

    for (const name of [
      'malformed.docx',
      'oversized.docx',
      'missing-slide.pptx',
      'missing-notes.pptx'
    ]) {
      await expect(
        decodeOffice({
          kind: name.endsWith('.docx') ? 'document' : 'slides',
          bytes: await fixture(name)
        })
      ).rejects.toMatchObject({ kind: 'invalid_input' });
    }

    await expect(decodeOffice({ kind: 'document', bytes: bytes('bad') })).rejects.toMatchObject({
      kind: 'invalid_input'
    });
  }
);

test.unit.stable(
  'deterministic rich decoders retain nested lists, cell boundaries, language, links and supported marks',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { canonicalText, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const html = decodeHtml({
      bytes: bytes(
        '<main><h3><strong>Title</strong></h3><ol start="3"><li>Parent<ul><li><em>Child</em></li></ul>After</li></ol><table><tr><th>A</th><td></td></tr></table><pre><code class="language-ts">let n = 1;</code></pre><p><a href="https://example.test/">Link</a></p><img src="external.png"></main>'
      )
    });

    assert.ok(Schema.is(documentSchema)(html) === true);
    expect(html.blocks.map((block) => block.text)).toStrictEqual([
      'Title',
      'Parent\nChild\nAfter',
      'A | ',
      'let n = 1;',
      'Link'
    ]);
    expect(
      html.blocks[1]!.content.type === 'list_item' &&
        html.blocks[1]!.content.items.map((item) => [
          item.depth,
          item.ordered,
          item.start,
          item.continuation
        ])
    ).toStrictEqual([
      [0, true, 3, false],
      [1, false, 1, false],
      [0, true, 3, true]
    ]);
    expect(
      html.blocks[2]!.content.type === 'table' &&
        html.blocks[2]!.content.rows[0]!.cells.map((cell) => cell.header)
    ).toStrictEqual([true, false]);
    assert.ok(html.blocks[3]!.content.type === 'code' && html.blocks[3]!.content.language === 'ts');
    assert.ok(
      html.blocks[4]!.content.type === 'paragraph' &&
        html.blocks[4]!.content.inlines[0]!.type === 'link'
    );
    assert.ok(html.meta.omissions.includes('embedded_media'));

    for (const block of html.blocks) assert.strictEqual(block.text, canonicalText(block.content));
  }
);

test.unit.stable(
  'Markdown retains nested lists, cell boundaries, code language and inline formatting',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { canonicalText, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const markdown = decodeText({
      kind: 'text',
      mime: 'text/markdown',
      bytes: bytes(
        '# **Title**\n\n3. Parent\n   - *Child*\n\nA | B\n--- | ---\nOne | Two\n\n```ts\nlet n = 1;\n```\n'
      )
    });

    assert.ok(Schema.is(documentSchema)(markdown) === true);
    expect(markdown.blocks.map((block) => block.text)).toStrictEqual([
      'Title',
      'Parent\nChild',
      'A | B\nOne | Two',
      'let n = 1;'
    ]);
    assert.strictEqual(
      markdown.blocks[1]!.content.type === 'list_item' &&
        markdown.blocks[1]!.content.items[1]!.depth,
      1
    );
    assert.ok(
      markdown.blocks[3]!.content.type === 'code' && markdown.blocks[3]!.content.language === 'ts'
    );

    assert.ok(markdown.meta.omissions.includes('unsupported_markup'));

    for (const block of markdown.blocks)
      assert.strictEqual(block.text, canonicalText(block.content));
  }
);

test.unit.stable(
  'Word keeps each table together and its title above its sections',
  async ({ expect }) => {
    const { zipSync } = await import('fflate');
    const { decodeOffice } = await import('#server/features/sources/decoders/office');
    const cell = (value: string) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;

    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Laboratorio</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Risultati</w:t></w:r></w:p>
    <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Fase')}${cell('Conteggio')}</w:tr>
    <w:tr>${cell('Metafase')}${cell('12')}</w:tr></w:tbl>
    <w:tbl><w:tr>${cell('Seconda tabella')}</w:tr></w:tbl>
  </w:body></w:document>`;
    const result = await decodeOffice({
      kind: 'document',
      bytes: zipSync({ 'word/document.xml': bytes(xml) })
    });

    expect(result.blocks.map((block) => block.content)).toMatchObject([
      { type: 'heading', level: 1 },
      { type: 'heading', level: 2 },
      {
        type: 'table',
        rows: [
          { cells: [{ header: true }, { header: true }] },
          { cells: [{ header: false }, { header: false }] }
        ]
      },
      { type: 'table', rows: [{ cells: [{ header: false }] }] }
    ]);
  }
);

test.unit.stable(
  'Office retains extracted marks and cells and reports nested-table loss',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { decodeOffice } = await import('#server/features/sources/decoders/office');
    const word = await decodeOffice({
      kind: 'document',
      bytes: await Bun.file(new URL('./fixtures/sample.docx', import.meta.url)).bytes()
    });

    expect(
      word.blocks[0]!.content.type === 'heading' && word.blocks[0]!.content.inlines[0]
    ).toStrictEqual({ type: 'text', text: 'Heading', marks: ['strong'] });
    expect(
      word.blocks[1]!.content.type === 'paragraph' && word.blocks[1]!.content.inlines[0]
    ).toStrictEqual({ type: 'text', text: 'First paragraph', marks: ['emphasis'] });
    const table = await decodeOffice({
      kind: 'document',
      bytes: await Bun.file(new URL('./fixtures/table.docx', import.meta.url)).bytes()
    });

    expect(
      table.blocks[1]!.content.type === 'table' &&
        table.blocks[1]!.content.rows[0]!.cells.map(
          (cell) => cell.paragraphs[0]![0]!.type === 'text' && cell.paragraphs[0]![0]!.text
        )
    ).toStrictEqual(['Left', 'Right']);
    const nested = await decodeOffice({
      kind: 'document',
      bytes: await Bun.file(new URL('./fixtures/nested-tables.docx', import.meta.url)).bytes()
    });

    assert.ok(nested.meta.omissions.includes('nested_table'));
  }
);

test.unit.stable(
  'source anchor validation rejects nonfinite, fractional, reversed and nonpositive locations centrally',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { anchorSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');

    for (const anchor of [
      { type: 'page', page: 0 },
      { type: 'page', page: Infinity },
      { type: 'time', startMs: 1.5, endMs: 2 },
      { type: 'time', startMs: 4, endMs: 3 },
      { type: 'text', lineStart: 2, lineEnd: 1, start: 0, end: 1 },
      { type: 'text', lineStart: 1, lineEnd: 2, start: 4, end: 2 },
      { type: 'slide', index: NaN }
    ])
      assert.ok(Schema.is(anchorSchema)(anchor) === false);
  }
);

test.unit.stable(
  'HTML preserves empty list ancestors without inventing continuations',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');

    for (const [source, depths, continuations] of [
      ['<ul><li><ul><li>Child</li></ul></li></ul>', [0, 1], [false, false]],
      [
        '<ul><li><ul><li><ol><li>Child</li></ol></li></ul></li></ul>',
        [0, 1, 2],
        [false, false, false]
      ],
      [
        '<ul><li><ul><li>Child</li></ul>After<ul><li>Second</li></ul></li></ul>',
        [0, 1, 0, 1],
        [false, false, true, false]
      ]
    ] as const) {
      const result = decodeHtml({ bytes: bytes('<main>' + source + '</main>') });

      assert.ok(Schema.is(documentSchema)(result) === true);
      const content = result.blocks[0]!.content;

      assert.ok(content.type === 'list_item');
      expect(content.items.map((item) => item.depth)).toStrictEqual(depths);
      expect(content.items.map((item) => item.continuation)).toStrictEqual(continuations);
      assert.strictEqual(content.items[0]!.inlines.length, 0);
    }
  }
);

test.unit.stable(
  'HTML table cells retain paragraphs, empty paragraphs and surrounding inline text',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { canonicalText, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const result = decodeHtml({
      bytes: bytes(
        '<main><table><tr><td>Before<p><strong>First</strong></p><p></p><div><p>Second</p></div>After</td><td></td></tr></table></main>'
      )
    });

    assert.ok(Schema.is(documentSchema)(result) === true);
    const content = result.blocks[0]!.content;

    assert.ok(content.type === 'table');
    const cell = content.rows[0]!.cells[0]!;

    expect(
      cell.paragraphs.map((inlines) => canonicalText({ type: 'paragraph', inlines }))
    ).toStrictEqual(['Before', 'First', '', 'Second', 'After']);
    expect(cell.paragraphs[1]).toStrictEqual([{ type: 'text', text: 'First', marks: ['strong'] }]);
    expect(content.rows[0]!.cells[1]!.paragraphs).toStrictEqual([[]]);
    assert.ok(result.blocks[0]!.text === 'Before\nFirst\n\nSecond\nAfter | ');
  }
);

test.unit.stable(
  'HTML groups loose phrasing without breaking words or losing inline marks',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { decodeHtml } = await import('#server/features/sources/decoders/html');

    for (const tag of ['main', 'article', 'section', 'div']) {
      const result = decodeHtml({
        bytes: bytes(
          `<${tag} id="flow">inter<strong>national</strong> <a href="https://example.test">link</a><p>Next</p>end<em>ing</em></${tag}>`
        ),
        url: 'https://example.test/page'
      });

      expect(result.blocks.map((block) => block.text)).toStrictEqual([
        'international link',
        'Next',
        'ending'
      ]);
      assert.ok(result.blocks[0]!.content.type === 'paragraph');

      if (result.blocks[0]!.content.type === 'paragraph')
        expect(result.blocks[0]!.content.inlines).toStrictEqual([
          { type: 'text', text: 'inter', marks: [] },
          { type: 'text', text: 'national', marks: ['strong'] },
          { type: 'text', text: ' ', marks: [] },
          { type: 'link', href: 'https://example.test/', text: 'link' }
        ]);

      expect(result.blocks[0]!.anchor).toStrictEqual({
        type: 'url',
        url: 'https://example.test/page',
        fragment: 'flow'
      });
    }
  }
);

test.unit.stable(
  'HTML list wrappers preserve descendants, paragraph boundaries and continuations',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const forms = [
      'Parent<ul><li>Child</li></ul>After',
      '<div>Parent<ul><li>Child</li></ul>After</div>',
      '<section><div><p>Parent</p><ul><li>Child</li></ul><p>After</p></div></section>'
    ];
    const contents = forms.map((item) => {
      const result = decodeHtml({
        bytes: bytes(`<ol start="3"><li>${item}</li><li><p>First</p><p>Second</p></li></ol>`)
      });

      Schema.decodeUnknownSync(documentSchema)(result);
      assert.ok(result.blocks[0]!.text === 'Parent\nChild\nAfter\nFirst\nSecond');

      return result.blocks[0]!.content;
    });

    expect(contents[1]).toStrictEqual(contents[0]);
    expect(contents[2]).toStrictEqual(contents[0]);
    const content = contents[0]!;

    assert.ok(content.type === 'list_item');

    if (content.type === 'list_item')
      expect(
        content.items.map(({ depth, start, continuation }) => ({ depth, start, continuation }))
      ).toStrictEqual([
        { depth: 0, start: 3, continuation: false },
        { depth: 1, start: 1, continuation: false },
        { depth: 0, start: 3, continuation: true },
        { depth: 0, start: 4, continuation: false },
        { depth: 0, start: 4, continuation: true }
      ]);
  }
);

test.unit.stable(
  'HTML structural and unknown wrappers retain nested flow without splitting phrasing',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');

    for (const wrapper of ['details open', 'study-wrapper']) {
      const tag = wrapper.split(' ')[0];
      const result = decodeHtml({
        bytes: bytes(
          `<main><${wrapper}><summary>Topic</summary><p>Before</p><ul><li>Evidence</li></ul><table><tr><td>Cell</td></tr></table>inter<strong>national</strong></${tag}></main>`
        )
      });

      Schema.decodeUnknownSync(documentSchema)(result);
      expect(result.blocks.map((block) => [block.content.type, block.text])).toStrictEqual([
        ['paragraph', 'Topic'],
        ['paragraph', 'Before'],
        ['list_item', 'Evidence'],
        ['table', 'Cell'],
        ['paragraph', 'international']
      ]);
      const list = decodeHtml({
        bytes: bytes(
          `<ol start="3"><li><${wrapper}><summary>Topic</summary><p>Before</p><ul><li>Evidence</li></ul><p>After</p>inter<strong>national</strong></${tag}></li></ol>`
        )
      });

      Schema.decodeUnknownSync(documentSchema)(list);
      assert.strictEqual(list.blocks.length, 1);
      assert.ok(list.blocks[0]!.text === 'Topic\nBefore\nEvidence\nAfter\ninternational');
      const content = list.blocks[0]!.content;

      assert.ok(content.type === 'list_item');

      if (content.type === 'list_item')
        expect(content.items.map(({ depth, continuation }) => [depth, continuation])).toStrictEqual(
          [
            [0, false],
            [0, true],
            [1, false],
            [0, true],
            [0, true]
          ]
        );
    }
  }
);

test.unit.stable(
  'generated Unicode paragraphs retain exact UTF-8 source anchor slices',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const paragraph = fc
      .string({ unit: 'grapheme', maxLength: 30 })
      .map((value) => `P:${value.replace(/[\r\n]/g, ' ')}:Q`);

    fc.assert(
      fc.property(
        fc.array(paragraph, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        fc.boolean(),
        (paragraphs, bom, newline) => {
          const input = new TextEncoder().encode(
            `${bom ? '\uFEFF' : ''}${paragraphs.join('\n\n')}${newline ? '\n' : ''}`
          );
          const document = decodeText({ bytes: input, kind: 'text', mime: 'text/plain' });
          let previousEnd = bom ? 3 : 0;

          expect(document.blocks).toHaveLength(paragraphs.length);

          for (const [index, block] of document.blocks.entries()) {
            assert.ok(block.anchor.type === 'text');
            expect(block.anchor.start).toBeGreaterThanOrEqual(previousEnd);
            expect(block.anchor.end).toBeLessThanOrEqual(input.length);
            const raw = paragraphs[index]! + (index < paragraphs.length - 1 || newline ? '\n' : '');

            expect(
              new TextDecoder().decode(input.slice(block.anchor.start, block.anchor.end))
            ).toBe(raw);
            expect(block.text).toBe(paragraphs[index]);
            previousEnd = block.anchor.end;
          }
        }
      ),
      { numRuns: 100 }
    );
  }
);

test.unit.stable(
  'Excel extracts ordered sheets and anchored worksheet cells',
  async ({ expect }) => {
    const { decoderPath } = await import('#server/features/sources/decoders/capability');
    const { detectedMime, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const source = detectedMime(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    expect(decoderPath(source)).toBe('office');

    const { decodeSpreadsheet } = await import('#server/features/sources/decoders/spreadsheet');
    const fixture = await Bun.file(new URL('./fixtures/sample.xlsx', import.meta.url)).bytes();
    const decoded = await decodeSpreadsheet(fixture);

    expect(Schema.is(documentSchema)(decoded)).toBe(true);
    expect(decoded.blocks.map(({ kind, text, anchor }) => [kind, text, anchor])).toStrictEqual([
      ['heading', 'Conteggio', { type: 'paragraph', index: 1 }],
      ['table', 'Cell & label |  | 0 | \n | 4 | 12.50% | ', { type: 'paragraph', index: 2 }],
      ['heading', 'Preparati', { type: 'paragraph', index: 3 }]
    ]);
    expect(decoded.blocks[1]?.content).toMatchObject({
      rows: [
        {
          cells: [
            {
              paragraphs: [
                [
                  { text: 'Cell', marks: ['strong'] },
                  { text: ' & label', marks: [] }
                ]
              ]
            },
            {},
            {},
            {}
          ]
        },
        { cells: [{}, {}, {}, {}] }
      ]
    });
  }
);

test.unit.stable('Excel hyperlink ranges do not introduce worksheet cells', async ({ expect }) => {
  const { unzipSync, zipSync } = await import('fflate');
  const { decodeSpreadsheet } = await import('#server/features/sources/decoders/spreadsheet');
  const path = 'xl/worksheets/sheet1.xml';
  const fixture = await Bun.file(new URL('./fixtures/sample.xlsx', import.meta.url)).bytes();
  const parts = unzipSync(fixture);
  const sheet = new TextDecoder().decode(parts[path]);

  parts[path] = bytes(
    sheet.replace(
      '</worksheet>',
      '<hyperlinks><hyperlink ref="E1:I5" location="A1"/></hyperlinks></worksheet>'
    )
  );

  const decoded = await decodeSpreadsheet(zipSync(parts));

  expect(decoded.blocks.map((block) => block.text)).toStrictEqual([
    'Conteggio',
    'Cell & label |  | 0 | \n | 4 | 12.50% | ',
    'Preparati'
  ]);
});

test.unit.stable('Excel bounds expanded archives and worksheet cells', async ({ expect }) => {
  const { unzipSync, zipSync } = await import('fflate');
  const { decodeSpreadsheet } = await import('#server/features/sources/decoders/spreadsheet');
  const fixture = await Bun.file(new URL('./fixtures/sample.xlsx', import.meta.url)).bytes();
  const parts = unzipSync(fixture);

  for (const extra of [
    new Uint8Array(16 * 1024 * 1024 + 1),
    bytes('<extra>' + '<c/>'.repeat(100_001) + '</extra>')
  ]) {
    await expect(
      decodeSpreadsheet(zipSync({ ...parts, 'xl/unused.xml': extra }))
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  }
});

test.unit.stable(
  'Excel reserves a cell parsing budget for each declared sheet',
  async ({ expect }) => {
    const { unzipSync, zipSync } = await import('fflate');
    const { decodeSpreadsheet } = await import('#server/features/sources/decoders/spreadsheet');
    const fixture = await Bun.file(new URL('./fixtures/sample.xlsx', import.meta.url)).bytes();
    const parts = unzipSync(fixture);
    const path = 'xl/worksheets/sheet1.xml';
    const xml = new TextDecoder().decode(parts[path]);
    const rows = Array.from({ length: 5001 }, (_, index) => {
      const row = index + 1;
      const cells = Array.from(
        'ABCDEFGHIJ',
        (column) => '<c r="' + column + row + '"><v>1</v></c>'
      );

      return '<row r="' + row + '">' + cells.join('') + '</row>';
    });

    parts[path] = bytes(
      xml.replace(
        /<sheetData>[\s\S]*?<\/sheetData>/,
        '<sheetData>' + rows.join('') + '</sheetData>'
      )
    );
    await expect(decodeSpreadsheet(zipSync(parts))).rejects.toMatchObject({
      kind: 'invalid_input'
    });
  }
);
