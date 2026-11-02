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

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { decodePdf } from '#server/features/sources/decoders/pdf';
import { decodeText } from '#server/features/sources/decoders/text';

const bytes = (value: string) => new TextEncoder().encode(value);

test('text decoding preserves UTF-8 byte anchors and markdown fences', () => {
  const result = decodeText({
    bytes: bytes('# Caffè\n\n```ts\nline\n\nmore\n```\n'),
    kind: 'text',
    mime: 'text/markdown'
  });

  assert.deepEqual(
    result.blocks.map((block) => block.kind),
    ['heading', 'code']
  );
  assert.deepEqual(result.blocks[1].anchor, {
    type: 'text',
    lineStart: 3,
    lineEnd: 7,
    start: 10,
    end: 31
  });
  assert.throws(
    () => decodeText({ bytes: new Uint8Array([255]), kind: 'text', mime: 'text/plain' }),
    { kind: 'invalid_input' }
  );
});

test('PDF decoding validates and counts pages', async () => {
  const fixture = await readFile(new URL('./fixtures/two-pages.pdf', import.meta.url));

  assert.equal(await decodePdf(fixture), 2);
  await assert.rejects(decodePdf(bytes('not a PDF')), { kind: 'invalid_input' });
});

test('vision transcription preserves page anchors and rejects incomplete or reordered pages', async () => {
  const { visionDocument } = await import('#server/features/sources/decoders/vision');
  const pages = [
    { page: 1, blocks: [{ kind: 'heading' as const, text: 'First' }] },
    { page: 2, blocks: [{ kind: 'paragraph' as const, text: 'Second' }] }
  ];
  const document = visionDocument(pages, 2);

  assert.deepEqual(
    document.blocks.map((block) => block.anchor),
    [
      { type: 'page', page: 1 },
      { type: 'page', page: 2 }
    ]
  );
  assert.equal(document.meta.pageCount, 2);
  assert.deepEqual(document.meta.omissions, ['provider_structure', 'layout', 'embedded_media']);
  assert.throws(() => visionDocument(pages.slice(0, 1), 2), { kind: 'invalid_input' });
  assert.throws(() => visionDocument([...pages].reverse(), 2), { kind: 'invalid_input' });
});

test('HTML extracts visible content and preserves URL fragments', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const document = decodeHtml({
    bytes: bytes(
      '<header>hidden</header><main><h1 id="top">Title</h1><p>Body &amp; detail</p><nav>menu</nav><style>bad</style><script>bad</script></main>'
    ),
    url: 'https://example.test/'
  });

  assert.deepEqual(
    document.blocks.map((block) => block.text),
    ['Title', 'Body & detail']
  );
  assert.deepEqual(document.blocks[0].anchor, {
    type: 'url',
    url: 'https://example.test/',
    fragment: 'top'
  });
  assert.deepEqual(
    decodeHtml({
      bytes: bytes(
        '<main><div>Intro <b>detail</b></div><ul><li>Parent<ul><li>Child</li></ul>After</li></ul></main>'
      )
    }).blocks.map((block) => [block.kind, block.text]),
    [
      ['paragraph', 'Intro detail'],
      ['list_item', 'Parent\nChild\nAfter']
    ]
  );

  assert.deepEqual(
    decodeHtml({ bytes: bytes('<main><p>Attachment</p></main>') }).blocks[0].anchor,
    { type: 'paragraph', index: 1 }
  );
});

test('Office decoders preserve structures and reject malformed or oversized archives', async () => {
  const { decodeOffice } = await import('#server/features/sources/decoders/office');
  const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

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

    assert.deepEqual(
      doc.blocks.map((block) => block.text),
      expected,
      name
    );
  }

  const slides = await decodeOffice({ kind: 'slides', bytes: await fixture('sample.pptx') });

  assert.equal(slides.meta.pageCount, 2);
  assert.deepEqual(
    slides.blocks.map((block) => block.anchor),
    [
      { type: 'slide', index: 1 },
      { type: 'slide', index: 1 },
      { type: 'slide', index: 2 }
    ]
  );

  for (const name of [
    'malformed.docx',
    'oversized.docx',
    'missing-slide.pptx',
    'missing-notes.pptx'
  ]) {
    await assert.rejects(
      decodeOffice({
        kind: name.endsWith('.docx') ? 'document' : 'slides',
        bytes: await fixture(name)
      }),
      { kind: 'invalid_input' }
    );
  }

  await assert.rejects(decodeOffice({ kind: 'document', bytes: bytes('bad') }), {
    kind: 'invalid_input'
  });
});

test('deterministic rich decoders retain nested lists, cell boundaries, language, links and supported marks', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const { canonicalText, documentSchema } = await import('@study/contracts/sources/schemas');
  const { Schema } = await import('effect');
  const html = decodeHtml({
    bytes: bytes(
      '<main><h3><strong>Title</strong></h3><ol start="3"><li>Parent<ul><li><em>Child</em></li></ul>After</li></ol><table><tr><th>A</th><td></td></tr></table><pre><code class="language-ts">let n = 1;</code></pre><p><a href="https://example.test/">Link</a></p><img src="external.png"></main>'
    )
  });

  assert.equal(Schema.is(documentSchema)(html), true);
  assert.deepEqual(
    html.blocks.map((block) => block.text),
    ['Title', 'Parent\nChild\nAfter', 'A | ', 'let n = 1;', 'Link']
  );
  assert.deepEqual(
    html.blocks[1]!.content.type === 'list_item' &&
      html.blocks[1]!.content.items.map((item) => [
        item.depth,
        item.ordered,
        item.start,
        item.continuation
      ]),
    [
      [0, true, 3, false],
      [1, false, 1, false],
      [0, true, 3, true]
    ]
  );
  assert.deepEqual(
    html.blocks[2]!.content.type === 'table' &&
      html.blocks[2]!.content.rows[0]!.cells.map((cell) => cell.header),
    [true, false]
  );
  assert.equal(html.blocks[3]!.content.type === 'code' && html.blocks[3]!.content.language, 'ts');
  assert.equal(
    html.blocks[4]!.content.type === 'paragraph' && html.blocks[4]!.content.inlines[0]!.type,
    'link'
  );
  assert.ok(html.meta.omissions.includes('embedded_media'));

  for (const block of html.blocks) assert.equal(block.text, canonicalText(block.content));
});

test('Markdown retains nested lists, cell boundaries, code language and inline formatting', async () => {
  const { canonicalText, documentSchema } = await import('@study/contracts/sources/schemas');
  const { Schema } = await import('effect');
  const markdown = decodeText({
    kind: 'text',
    mime: 'text/markdown',
    bytes: bytes(
      '# **Title**\n\n3. Parent\n   - *Child*\n\nA | B\n--- | ---\nOne | Two\n\n```ts\nlet n = 1;\n```\n'
    )
  });

  assert.equal(Schema.is(documentSchema)(markdown), true);
  assert.deepEqual(
    markdown.blocks.map((block) => block.text),
    ['Title', 'Parent\nChild', 'A | B\nOne | Two', 'let n = 1;']
  );
  assert.equal(
    markdown.blocks[1]!.content.type === 'list_item' && markdown.blocks[1]!.content.items[1]!.depth,
    1
  );
  assert.equal(
    markdown.blocks[3]!.content.type === 'code' && markdown.blocks[3]!.content.language,
    'ts'
  );

  assert.ok(markdown.meta.omissions.includes('unsupported_markup'));

  for (const block of markdown.blocks) assert.equal(block.text, canonicalText(block.content));
});

test('Office retains extracted marks and cells and reports nested-table loss', async () => {
  const { decodeOffice } = await import('#server/features/sources/decoders/office');
  const word = await decodeOffice({
    kind: 'document',
    bytes: await readFile(new URL('./fixtures/sample.docx', import.meta.url))
  });

  assert.deepEqual(
    word.blocks[0]!.content.type === 'heading' && word.blocks[0]!.content.inlines[0],
    { type: 'text', text: 'Heading', marks: ['strong'] }
  );
  assert.deepEqual(
    word.blocks[1]!.content.type === 'paragraph' && word.blocks[1]!.content.inlines[0],
    { type: 'text', text: 'First paragraph', marks: ['emphasis'] }
  );
  const table = await decodeOffice({
    kind: 'document',
    bytes: await readFile(new URL('./fixtures/table.docx', import.meta.url))
  });

  assert.deepEqual(
    table.blocks[1]!.content.type === 'table' &&
      table.blocks[1]!.content.rows[0]!.cells.map(
        (cell) => cell.paragraphs[0]![0]!.type === 'text' && cell.paragraphs[0]![0]!.text
      ),
    ['Left', 'Right']
  );
  const nested = await decodeOffice({
    kind: 'document',
    bytes: await readFile(new URL('./fixtures/nested-tables.docx', import.meta.url))
  });

  assert.ok(nested.meta.omissions.includes('nested_table'));
});

test('source anchor validation rejects nonfinite, fractional, reversed and nonpositive locations centrally', async () => {
  const { anchorSchema } = await import('@study/contracts/sources/schemas');
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
    assert.equal(Schema.is(anchorSchema)(anchor), false);
});

test('HTML preserves empty list ancestors without inventing continuations', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const { documentSchema } = await import('@study/contracts/sources/schemas');
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

    assert.equal(Schema.is(documentSchema)(result), true);
    const content = result.blocks[0]!.content;

    assert.equal(content.type, 'list_item');
    assert.deepEqual(
      content.items.map((item) => item.depth),
      depths
    );
    assert.deepEqual(
      content.items.map((item) => item.continuation),
      continuations
    );
    assert.equal(content.items[0]!.inlines.length, 0);
  }
});

test('HTML table cells retain paragraphs, empty paragraphs and surrounding inline text', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const { canonicalText, documentSchema } = await import('@study/contracts/sources/schemas');
  const { Schema } = await import('effect');
  const result = decodeHtml({
    bytes: bytes(
      '<main><table><tr><td>Before<p><strong>First</strong></p><p></p><div><p>Second</p></div>After</td><td></td></tr></table></main>'
    )
  });

  assert.equal(Schema.is(documentSchema)(result), true);
  const content = result.blocks[0]!.content;

  assert.equal(content.type, 'table');
  const cell = content.rows[0]!.cells[0]!;

  assert.deepEqual(
    cell.paragraphs.map((inlines) => canonicalText({ type: 'paragraph', inlines })),
    ['Before', 'First', '', 'Second', 'After']
  );
  assert.deepEqual(cell.paragraphs[1], [{ type: 'text', text: 'First', marks: ['strong'] }]);
  assert.deepEqual(content.rows[0]!.cells[1]!.paragraphs, [[]]);
  assert.equal(result.blocks[0]!.text, 'Before\nFirst\n\nSecond\nAfter | ');
});

test('HTML groups loose phrasing without breaking words or losing inline marks', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');

  for (const tag of ['main', 'article', 'section', 'div']) {
    const result = decodeHtml({
      bytes: bytes(
        `<${tag} id="flow">inter<strong>national</strong> <a href="https://example.test">link</a><p>Next</p>end<em>ing</em></${tag}>`
      ),
      url: 'https://example.test/page'
    });

    assert.deepEqual(
      result.blocks.map((block) => block.text),
      ['international link', 'Next', 'ending']
    );
    assert.equal(result.blocks[0]!.content.type, 'paragraph');
    if (result.blocks[0]!.content.type === 'paragraph')
      assert.deepEqual(result.blocks[0]!.content.inlines, [
        { type: 'text', text: 'inter', marks: [] },
        { type: 'text', text: 'national', marks: ['strong'] },
        { type: 'text', text: ' ', marks: [] },
        { type: 'link', href: 'https://example.test/', text: 'link' }
      ]);
    assert.deepEqual(result.blocks[0]!.anchor, {
      type: 'url',
      url: 'https://example.test/page',
      fragment: 'flow'
    });
  }
});

test('HTML list wrappers preserve descendants, paragraph boundaries and continuations', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const { documentSchema } = await import('@study/contracts/sources/schemas');
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
    assert.equal(result.blocks[0]!.text, 'Parent\nChild\nAfter\nFirst\nSecond');

    return result.blocks[0]!.content;
  });

  assert.deepEqual(contents[1], contents[0]);
  assert.deepEqual(contents[2], contents[0]);
  const content = contents[0]!;

  assert.equal(content.type, 'list_item');
  if (content.type === 'list_item')
    assert.deepEqual(
      content.items.map(({ depth, start, continuation }) => ({ depth, start, continuation })),
      [
        { depth: 0, start: 3, continuation: false },
        { depth: 1, start: 1, continuation: false },
        { depth: 0, start: 3, continuation: true },
        { depth: 0, start: 4, continuation: false },
        { depth: 0, start: 4, continuation: true }
      ]
    );
});

test('HTML structural and unknown wrappers retain nested flow without splitting phrasing', async () => {
  const { decodeHtml } = await import('#server/features/sources/decoders/html');
  const { documentSchema } = await import('@study/contracts/sources/schemas');
  const { Schema } = await import('effect');
  for (const wrapper of ['details open', 'study-wrapper']) {
    const tag = wrapper.split(' ')[0];
    const result = decodeHtml({
      bytes: bytes(
        `<main><${wrapper}><summary>Topic</summary><p>Before</p><ul><li>Evidence</li></ul><table><tr><td>Cell</td></tr></table>inter<strong>national</strong></${tag}></main>`
      )
    });
    Schema.decodeUnknownSync(documentSchema)(result);
    assert.deepEqual(
      result.blocks.map((block) => [block.content.type, block.text]),
      [
        ['paragraph', 'Topic'],
        ['paragraph', 'Before'],
        ['list_item', 'Evidence'],
        ['table', 'Cell'],
        ['paragraph', 'international']
      ]
    );
    const list = decodeHtml({
      bytes: bytes(
        `<ol start="3"><li><${wrapper}><summary>Topic</summary><p>Before</p><ul><li>Evidence</li></ul><p>After</p>inter<strong>national</strong></${tag}></li></ol>`
      )
    });
    Schema.decodeUnknownSync(documentSchema)(list);
    assert.equal(list.blocks.length, 1);
    assert.equal(list.blocks[0]!.text, 'Topic\nBefore\nEvidence\nAfter\ninternational');
    const content = list.blocks[0]!.content;
    assert.equal(content.type, 'list_item');
    if (content.type === 'list_item')
      assert.deepEqual(
        content.items.map(({ depth, continuation }) => [depth, continuation]),
        [
          [0, false],
          [0, true],
          [1, false],
          [0, true],
          [0, true]
        ]
      );
  }
});
