import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { pdfPageCount } from './pdf.ts';
import { readSource } from './read.ts';

const input = (
  kind: 'text' | 'code' | 'web' | 'document' | 'slides' | 'pdf' | 'image',
  mime: string,
  bytes: Uint8Array
) => ({ kind, mime, bytes, name: 'sample' });

const bytes = (text: string) => new TextEncoder().encode(text);

test('text and code preserve UTF-8 byte anchors and markdown fences', async () => {
  const d = await readSource(
    input('text', 'text/markdown', bytes('# Caffè\n\n```ts\nline\n\nmore\n```\n'))
  );

  assert.deepEqual(
    d.blocks.map((b) => b.kind),
    ['heading', 'code']
  );
  assert.equal(d.blocks[1].anchor.type, 'text');

  if (d.blocks[1].anchor.type === 'text')
    assert.equal(d.blocks[1].anchor.start, Buffer.byteLength('# Caffè\n\n'));

  await assert.rejects(readSource(input('text', 'text/plain', new Uint8Array([255]))), {
    kind: 'invalid_input'
  });
});
test('HTML extracts visible structured content and fragments', async () => {
  const d = await readSource({
    ...input(
      'web',
      'text/html',
      bytes('<main><h1 id="top">Title</h1><p>Body &amp; detail</p><script>bad</script></main>')
    ),
    url: 'https://example.test/'
  });

  assert.deepEqual(
    d.blocks.map((b) => b.text),
    ['Title', 'Body & detail']
  );
  assert.deepEqual(d.blocks[0].anchor, {
    type: 'url',
    url: 'https://example.test/',
    fragment: 'top'
  });
});
test('Office ZIP fixtures extract ordered slides, headings and speaker notes', async () => {
  const doc = await readFile(new URL('./fixtures/sample.docx', import.meta.url)),
    slides = await readFile(new URL('./fixtures/sample.pptx', import.meta.url));
  const a = await readSource(
    input(
      'document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc
    )
  );

  assert.deepEqual(
    a.blocks.map((b) => [b.kind, b.text]),
    [
      ['heading', 'Heading'],
      ['paragraph', 'First paragraph']
    ]
  );
  const b = await readSource(
    input(
      'slides',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      slides
    )
  );

  assert.deepEqual(
    b.blocks.map((b) => b.text),
    ['Slide 2', 'Speaker notes', 'Slide 1']
  );
  assert.equal(b.meta.pageCount, 2);
  await assert.rejects(
    readSource(
      input(
        'document',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes('bad')
      )
    ),
    { kind: 'invalid_input' }
  );
});
test('unsupported media and over-limit input fail explicitly', async () => {
  await assert.rejects(
    readSource({
      kind: 'audio',
      mime: 'audio/wav',
      bytes: bytes('audio'),
      name: 'a'
    }),
    { kind: 'unsupported' }
  );
  await assert.rejects(readSource(input('text', 'text/plain', bytes('abcd')), { maxBytes: 3 }), {
    kind: 'invalid_input'
  });
});

test('expanded Office content is bounded before decompression', async () => {
  const data = await readFile(new URL('./fixtures/oversized.docx', import.meta.url));

  await assert.rejects(
    readSource(
      input(
        'document',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data
      )
    ),
    { kind: 'invalid_input' }
  );
});

test('UTF-8 BOM offsets select original source bytes', async () => {
  const source = bytes('\uFEFFCaffè\n\nsecond');
  const d = await readSource(input('text', 'text/plain', source));
  const anchor = d.blocks[0].anchor;

  assert.equal(anchor.type, 'text');

  if (anchor.type === 'text') {
    assert.equal(anchor.start, 3);
    assert.equal(new TextDecoder().decode(source.slice(anchor.start, anchor.end)).trim(), 'Caffè');
  }
});

test('HTML retains bare container text and nested list order', async () => {
  const d = await readSource(
    input(
      'web',
      'text/html',
      bytes(
        '<main><div>Intro <b>detail</b></div><ul><li>Parent<ul><li>Child</li></ul>After</li></ul></main>'
      )
    )
  );

  assert.deepEqual(
    d.blocks.map((b) => [b.kind, b.text]),
    [
      ['paragraph', 'Intro detail'],
      ['list_item', 'Parent'],
      ['list_item', 'Child'],
      ['list_item', 'After']
    ]
  );
});

test('Office tables and shapes retain source order, malformed references fail', async () => {
  const fixture = async (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const doc = await readSource(input('document', docx, await fixture('table.docx')));

  assert.deepEqual(
    doc.blocks.map((b) => [b.kind, b.text]),
    [
      ['paragraph', 'Before'],
      ['table', 'Left | Right'],
      ['paragraph', 'After']
    ]
  );
  const slides = await readSource(input('slides', pptx, await fixture('interleaved.pptx')));

  assert.deepEqual(
    slides.blocks.map((b) => [b.kind, b.text]),
    [
      ['paragraph', 'Before'],
      ['table', 'Cell'],
      ['paragraph', 'After']
    ]
  );

  for (const name of ['missing-slide.pptx', 'missing-notes.pptx'])
    await assert.rejects(readSource(input('slides', pptx, await fixture(name))), {
      kind: 'invalid_input'
    });

  await assert.rejects(readSource(input('document', docx, await fixture('malformed.docx'))), {
    kind: 'invalid_input'
  });
});

test('nested DOCX tables retain each text exactly once in document order', async () => {
  const bytes = await readFile(new URL('./fixtures/nested-tables.docx', import.meta.url));
  const d = await readSource(
    input(
      'document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes
    )
  );

  assert.deepEqual(
    d.blocks.map((b) => [b.kind, b.text]),
    [
      ['table', 'Before'],
      ['table', 'Inner A | Inner B'],
      ['table', 'Inner C'],
      ['table', 'After | Outer second']
    ]
  );
});

test('DOCX content controls preserve wrapped paragraphs and nested table order', async () => {
  const data = await readFile(new URL('./fixtures/wrapped.docx', import.meta.url));
  const d = await readSource(
    input(
      'document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data
    )
  );

  assert.deepEqual(
    d.blocks.map((b) => [b.kind, b.text]),
    [
      ['paragraph', 'Wrapped document'],
      ['table', 'Before Wrapped'],
      ['table', 'Nested'],
      ['table', 'Wrapped after After | Other cell']
    ]
  );
});

test('vision requires a signed-in model for image and valid PDF sources', async () => {
  for (const source of [
    input('image', 'image/png', bytes('image')),
    input(
      'pdf',
      'application/pdf',
      await readFile(new URL('./fixtures/two-pages.pdf', import.meta.url))
    )
  ]) {
    await assert.rejects(readSource(source), { kind: 'config' });
  }
});

test('PDF binary validation counts real pages and rejects malformed payloads', async () => {
  const pdf = await readFile(new URL('./fixtures/two-pages.pdf', import.meta.url));

  assert.equal(await pdfPageCount(pdf), 2);

  for (const payload of [bytes('not a PDF'), new Uint8Array(), pdf.subarray(0, 20)]) {
    await assert.rejects(pdfPageCount(payload), { kind: 'invalid_input' });
  }
});
