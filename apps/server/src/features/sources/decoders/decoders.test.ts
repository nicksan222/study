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

test.stable('text decoding preserves UTF-8 byte anchors and markdown fences', () => {
  const result = decodeText({
    bytes: bytes('# Caffè\n\n```ts\nline\n\nmore\n```\n'),
    kind: 'text',
    mime: 'text/markdown'
  });

  test.expect(result.blocks.map((block) => block.kind)).toStrictEqual(['heading', 'code']);
  test.expect(result.blocks[1].anchor).toStrictEqual({
    type: 'text',
    lineStart: 3,
    lineEnd: 7,
    start: 10,
    end: 31
  });
  test
    .expect(() => decodeText({ bytes: new Uint8Array([255]), kind: 'text', mime: 'text/plain' }))
    .toThrow(test.expect.objectContaining({ kind: 'invalid_input' }));
});

test.stable('PDF decoding validates and counts pages', async () => {
  const fixture = await Bun.file(new URL('./fixtures/two-pages.pdf', import.meta.url)).bytes();

  test.assert.strictEqual(await decodePdf(fixture), 2);
  await test.expect(decodePdf(bytes('not a PDF'))).rejects.toMatchObject({ kind: 'invalid_input' });
});

test.stable(
  'vision transcription preserves page anchors and rejects incomplete or reordered pages',
  async () => {
    const { visionDocument } = await import('#server/features/sources/decoders/vision');
    const pages = [
      { page: 1, blocks: [{ kind: 'heading' as const, text: 'First' }] },
      { page: 2, blocks: [{ kind: 'paragraph' as const, text: 'Second' }] }
    ];
    const document = visionDocument(pages, 2);

    test.expect(document.blocks.map((block) => block.anchor)).toStrictEqual([
      { type: 'page', page: 1 },
      { type: 'page', page: 2 }
    ]);
    test.assert.strictEqual(document.meta.pageCount, 2);
    test
      .expect(document.meta.omissions)
      .toStrictEqual(['provider_structure', 'layout', 'embedded_media']);
    test
      .expect(() => visionDocument(pages.slice(0, 1), 2))
      .toThrow(test.expect.objectContaining({ kind: 'invalid_input' }));
    test
      .expect(() => visionDocument([...pages].reverse(), 2))
      .toThrow(test.expect.objectContaining({ kind: 'invalid_input' }));
  }
);

test.stable('HTML extracts visible content and preserves URL fragments', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const document = decodeHtml({
    bytes: bytes(
      '<header>hidden</header><main><h1 id="top">Title</h1><p>Body &amp; detail</p><nav>menu</nav><style>bad</style><script>bad</script></main>'
    ),
    url: 'https://example.test/'
  });

  test.expect(document.blocks.map((block) => block.text)).toStrictEqual(['Title', 'Body & detail']);
  test.expect(document.blocks[0].anchor).toStrictEqual({
    type: 'url',
    url: 'https://example.test/',
    fragment: 'top'
  });
  test
    .expect(
      decodeHtml({
        bytes: bytes(
          '<main><div>Intro <b>detail</b></div><ul><li>Parent<ul><li>Child</li></ul>After</li></ul></main>'
        )
      }).blocks.map((block) => [block.kind, block.text])
    )
    .toStrictEqual([
      ['paragraph', 'Intro detail'],
      ['list_item', 'Parent\nChild\nAfter']
    ]);

  test
    .expect(decodeHtml({ bytes: bytes('<main><p>Attachment</p></main>') }).blocks[0].anchor)
    .toStrictEqual({ type: 'paragraph', index: 1 });
});

test.stable(
  'Office decoders preserve structures and reject malformed or oversized archives',
  async () => {
    const { decodeOffice } = await import('#server/features/sources/decoders/office');
    const fixture = (name: string) =>
      Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).bytes();

    for (const [name, kind, expected] of [
      ['sample.docx', 'document', ['Heading', 'First paragraph']],
      ['table.docx', 'document', ['Before', 'Left | Right', 'After']],
      [
        'nested-tables.docx',
        'document',
        ['Before', 'Inner A | Inner B', 'Inner C', 'After | Outer second']
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

      test
        .expect(
          doc.blocks.map((block) => block.text),
          name
        )
        .toStrictEqual(expected);
    }

    const slides = await decodeOffice({ kind: 'slides', bytes: await fixture('sample.pptx') });

    test.assert.strictEqual(slides.meta.pageCount, 2);
    test.expect(slides.blocks.map((block) => block.anchor)).toStrictEqual([
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
      await test
        .expect(
          decodeOffice({
            kind: name.endsWith('.docx') ? 'document' : 'slides',
            bytes: await fixture(name)
          })
        )
        .rejects.toMatchObject({ kind: 'invalid_input' });
    }

    await test
      .expect(decodeOffice({ kind: 'document', bytes: bytes('bad') }))
      .rejects.toMatchObject({
        kind: 'invalid_input'
      });
  }
);

test.stable(
  'deterministic rich decoders retain nested lists, cell boundaries, language, links and supported marks',
  async () => {
    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { canonicalText, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const html = decodeHtml({
      bytes: bytes(
        '<main><h3><strong>Title</strong></h3><ol start="3"><li>Parent<ul><li><em>Child</em></li></ul>After</li></ol><table><tr><th>A</th><td></td></tr></table><pre><code class="language-ts">let n = 1;</code></pre><p><a href="https://example.test/">Link</a></p><img src="external.png"></main>'
      )
    });

    test.assert.ok(Schema.is(documentSchema)(html) === true);
    test
      .expect(html.blocks.map((block) => block.text))
      .toStrictEqual(['Title', 'Parent\nChild\nAfter', 'A | ', 'let n = 1;', 'Link']);
    test
      .expect(
        html.blocks[1]!.content.type === 'list_item' &&
          html.blocks[1]!.content.items.map((item) => [
            item.depth,
            item.ordered,
            item.start,
            item.continuation
          ])
      )
      .toStrictEqual([
        [0, true, 3, false],
        [1, false, 1, false],
        [0, true, 3, true]
      ]);
    test
      .expect(
        html.blocks[2]!.content.type === 'table' &&
          html.blocks[2]!.content.rows[0]!.cells.map((cell) => cell.header)
      )
      .toStrictEqual([true, false]);
    test.assert.ok(
      html.blocks[3]!.content.type === 'code' && html.blocks[3]!.content.language === 'ts'
    );
    test.assert.ok(
      html.blocks[4]!.content.type === 'paragraph' &&
        html.blocks[4]!.content.inlines[0]!.type === 'link'
    );
    test.assert.ok(html.meta.omissions.includes('embedded_media'));

    for (const block of html.blocks)
      test.assert.strictEqual(block.text, canonicalText(block.content));
  }
);

test.stable(
  'Markdown retains nested lists, cell boundaries, code language and inline formatting',
  async () => {
    const { canonicalText, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const markdown = decodeText({
      kind: 'text',
      mime: 'text/markdown',
      bytes: bytes(
        '# **Title**\n\n3. Parent\n   - *Child*\n\nA | B\n--- | ---\nOne | Two\n\n```ts\nlet n = 1;\n```\n'
      )
    });

    test.assert.ok(Schema.is(documentSchema)(markdown) === true);
    test
      .expect(markdown.blocks.map((block) => block.text))
      .toStrictEqual(['Title', 'Parent\nChild', 'A | B\nOne | Two', 'let n = 1;']);
    test.assert.strictEqual(
      markdown.blocks[1]!.content.type === 'list_item' &&
        markdown.blocks[1]!.content.items[1]!.depth,
      1
    );
    test.assert.ok(
      markdown.blocks[3]!.content.type === 'code' && markdown.blocks[3]!.content.language === 'ts'
    );

    test.assert.ok(markdown.meta.omissions.includes('unsupported_markup'));

    for (const block of markdown.blocks)
      test.assert.strictEqual(block.text, canonicalText(block.content));
  }
);

test.stable('Office retains extracted marks and cells and reports nested-table loss', async () => {
  const { decodeOffice } = await import('#server/features/sources/decoders/office');
  const word = await decodeOffice({
    kind: 'document',
    bytes: await Bun.file(new URL('./fixtures/sample.docx', import.meta.url)).bytes()
  });

  test
    .expect(word.blocks[0]!.content.type === 'heading' && word.blocks[0]!.content.inlines[0])
    .toStrictEqual({ type: 'text', text: 'Heading', marks: ['strong'] });
  test
    .expect(word.blocks[1]!.content.type === 'paragraph' && word.blocks[1]!.content.inlines[0])
    .toStrictEqual({ type: 'text', text: 'First paragraph', marks: ['emphasis'] });
  const table = await decodeOffice({
    kind: 'document',
    bytes: await Bun.file(new URL('./fixtures/table.docx', import.meta.url)).bytes()
  });

  test
    .expect(
      table.blocks[1]!.content.type === 'table' &&
        table.blocks[1]!.content.rows[0]!.cells.map(
          (cell) => cell.paragraphs[0]![0]!.type === 'text' && cell.paragraphs[0]![0]!.text
        )
    )
    .toStrictEqual(['Left', 'Right']);
  const nested = await decodeOffice({
    kind: 'document',
    bytes: await Bun.file(new URL('./fixtures/nested-tables.docx', import.meta.url)).bytes()
  });

  test.assert.ok(nested.meta.omissions.includes('nested_table'));
});

test.stable(
  'source anchor validation rejects nonfinite, fractional, reversed and nonpositive locations centrally',
  async () => {
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
      test.assert.ok(Schema.is(anchorSchema)(anchor) === false);
  }
);

test.stable('HTML preserves empty list ancestors without inventing continuations', async () => {
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

    test.assert.ok(Schema.is(documentSchema)(result) === true);
    const content = result.blocks[0]!.content;

    test.assert.ok(content.type === 'list_item');
    test.expect(content.items.map((item) => item.depth)).toStrictEqual(depths);
    test.expect(content.items.map((item) => item.continuation)).toStrictEqual(continuations);
    test.assert.strictEqual(content.items[0]!.inlines.length, 0);
  }
});

test.stable(
  'HTML table cells retain paragraphs, empty paragraphs and surrounding inline text',
  async () => {
    const { decodeHtml } = await import('#server/features/sources/decoders/html');
    const { canonicalText, documentSchema } = await import('@study/contracts');
    const { Schema } = await import('effect');
    const result = decodeHtml({
      bytes: bytes(
        '<main><table><tr><td>Before<p><strong>First</strong></p><p></p><div><p>Second</p></div>After</td><td></td></tr></table></main>'
      )
    });

    test.assert.ok(Schema.is(documentSchema)(result) === true);
    const content = result.blocks[0]!.content;

    test.assert.ok(content.type === 'table');
    const cell = content.rows[0]!.cells[0]!;

    test
      .expect(cell.paragraphs.map((inlines) => canonicalText({ type: 'paragraph', inlines })))
      .toStrictEqual(['Before', 'First', '', 'Second', 'After']);
    test
      .expect(cell.paragraphs[1])
      .toStrictEqual([{ type: 'text', text: 'First', marks: ['strong'] }]);
    test.expect(content.rows[0]!.cells[1]!.paragraphs).toStrictEqual([[]]);
    test.assert.ok(result.blocks[0]!.text === 'Before\nFirst\n\nSecond\nAfter | ');
  }
);

test.stable(
  'HTML groups loose phrasing without breaking words or losing inline marks',
  async () => {
    const { decodeHtml } = await import('#server/features/sources/decoders/html');

    for (const tag of ['main', 'article', 'section', 'div']) {
      const result = decodeHtml({
        bytes: bytes(
          `<${tag} id="flow">inter<strong>national</strong> <a href="https://example.test">link</a><p>Next</p>end<em>ing</em></${tag}>`
        ),
        url: 'https://example.test/page'
      });

      test
        .expect(result.blocks.map((block) => block.text))
        .toStrictEqual(['international link', 'Next', 'ending']);
      test.assert.ok(result.blocks[0]!.content.type === 'paragraph');

      if (result.blocks[0]!.content.type === 'paragraph')
        test.expect(result.blocks[0]!.content.inlines).toStrictEqual([
          { type: 'text', text: 'inter', marks: [] },
          { type: 'text', text: 'national', marks: ['strong'] },
          { type: 'text', text: ' ', marks: [] },
          { type: 'link', href: 'https://example.test/', text: 'link' }
        ]);

      test.expect(result.blocks[0]!.anchor).toStrictEqual({
        type: 'url',
        url: 'https://example.test/page',
        fragment: 'flow'
      });
    }
  }
);

test.stable(
  'HTML list wrappers preserve descendants, paragraph boundaries and continuations',
  async () => {
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
      test.assert.ok(result.blocks[0]!.text === 'Parent\nChild\nAfter\nFirst\nSecond');

      return result.blocks[0]!.content;
    });

    test.expect(contents[1]).toStrictEqual(contents[0]);
    test.expect(contents[2]).toStrictEqual(contents[0]);
    const content = contents[0]!;

    test.assert.ok(content.type === 'list_item');

    if (content.type === 'list_item')
      test
        .expect(
          content.items.map(({ depth, start, continuation }) => ({ depth, start, continuation }))
        )
        .toStrictEqual([
          { depth: 0, start: 3, continuation: false },
          { depth: 1, start: 1, continuation: false },
          { depth: 0, start: 3, continuation: true },
          { depth: 0, start: 4, continuation: false },
          { depth: 0, start: 4, continuation: true }
        ]);
  }
);

test.stable(
  'HTML structural and unknown wrappers retain nested flow without splitting phrasing',
  async () => {
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
      test.expect(result.blocks.map((block) => [block.content.type, block.text])).toStrictEqual([
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
      test.assert.strictEqual(list.blocks.length, 1);
      test.assert.ok(list.blocks[0]!.text === 'Topic\nBefore\nEvidence\nAfter\ninternational');
      const content = list.blocks[0]!.content;

      test.assert.ok(content.type === 'list_item');

      if (content.type === 'list_item')
        test
          .expect(content.items.map(({ depth, continuation }) => [depth, continuation]))
          .toStrictEqual([
            [0, false],
            [0, true],
            [1, false],
            [0, true],
            [0, true]
          ]);
    }
  }
);

test.stable('generated Unicode paragraphs retain exact UTF-8 source anchor slices', () => {
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

        test.expect(document.blocks).toHaveLength(paragraphs.length);

        for (const [index, block] of document.blocks.entries()) {
          test.assert.ok(block.anchor.type === 'text');
          test.expect(block.anchor.start).toBeGreaterThanOrEqual(previousEnd);
          test.expect(block.anchor.end).toBeLessThanOrEqual(input.length);
          const raw = paragraphs[index]! + (index < paragraphs.length - 1 || newline ? '\n' : '');

          test
            .expect(new TextDecoder().decode(input.slice(block.anchor.start, block.anchor.end)))
            .toBe(raw);
          test.expect(block.text).toBe(paragraphs[index]);
          previousEnd = block.anchor.end;
        }
      }
    ),
    { numRuns: 100 }
  );
});
