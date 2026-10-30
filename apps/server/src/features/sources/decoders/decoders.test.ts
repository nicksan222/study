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
      ['list_item', 'Parent'],
      ['list_item', 'Child'],
      ['list_item', 'After']
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
