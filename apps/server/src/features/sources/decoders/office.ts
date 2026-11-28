/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads supported Office archive documents and converts their structured text and    │
 * │ tables into canonical document blocks.                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Source decoders convert bounded input bytes into canonical document data.              │
 * │ - Validates format input and constructs decoded content.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Does not choose ingestion policy or persist source state.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import { createBlock, plainBlock } from '@study/contracts';
import type { Anchor, Block } from '@study/contracts';
import type { Document } from '@study/contracts';
import type { Inline } from '@study/contracts';
import { posixPaths } from '@study/server';
import { load } from 'cheerio';
import { XMLValidator } from 'fast-xml-parser';
import type { ZipFile } from 'yauzl';

import { checkAbort, document } from './common.ts';
import { openZip, nextZipEntry, readZipXml } from './zip.ts';

const posix = posixPaths;

const MAX_ENTRIES = 5000,
  MAX_EXPANDED = 32 * 1024 * 1024;

async function xmlParts(bytes: Uint8Array, signal?: AbortSignal): Promise<Map<string, string>> {
  let zip: ZipFile | undefined;

  try {
    zip = await openZip(bytes);
    const parts = new Map<string, string>();
    let count = 0,
      total = 0;

    for (;;) {
      checkAbort(signal);
      const entry = await nextZipEntry(zip);

      if (!entry) break;

      if (++count > MAX_ENTRIES)
        throw new StudyError('invalid_input', 'Office archive has too many entries');

      if (!/^(word\/document\.xml|ppt\/.*\.(xml|rels))$/.test(entry.fileName)) continue;

      if (parts.has(entry.fileName))
        throw new StudyError('invalid_input', 'Office archive has duplicate parts');

      total += entry.uncompressedSize;

      if (total > MAX_EXPANDED)
        throw new StudyError('invalid_input', 'Office XML exceeds the size limit');

      parts.set(entry.fileName, await readZipXml(zip, entry, MAX_EXPANDED, signal));
    }

    return parts;
  } catch (error) {
    if (error instanceof StudyError) throw error;

    throw new StudyError('invalid_input', 'Invalid Office archive', {
      cause: error
    });
  } finally {
    zip?.close();
  }
}

function parseXml(xml: string) {
  if (XMLValidator.validate(xml) !== true)
    throw new StudyError('invalid_input', 'Malformed Office XML');

  return load(xml, { xml: true });
}

function targetPart(base: string, target: string): string {
  const part = posix.normalize(posix.join(base, target));

  if (part.startsWith('../') || part.startsWith('/'))
    throw new StudyError('invalid_input', 'Invalid Office relationship target');

  return part;
}

function readDocx(parts: Map<string, string>): Block[] {
  const xml = parts.get('word/document.xml');

  if (!xml) throw new StudyError('invalid_input', 'Word document body is missing');

  const $ = parseXml(xml),
    blocks: Block[] = [];
  const body = $('w\\:document > w\\:body');

  if (body.length !== 1) throw new StudyError('invalid_input', 'Word document body is missing');

  type Element = (typeof body)[number];

  // Traverse wrappers such as content controls, stopping at each structural element
  // so a nested table is handled exactly once at its original position.
  const visitChildren = (parent: Element, tag: string, visit: (element: Element) => void): void => {
    $(parent)
      .children()
      .each((_, child) => {
        if (child.tagName === tag) visit(child);
        else if (child.tagName !== 'w:tbl') visitChildren(child, tag, visit);
      });
  };
  const paragraphInlines = (paragraph: Element): Inline[] =>
    $(paragraph)
      .find('w\\:r')
      .toArray()
      .map((run) => {
        const marks: Extract<Inline, { type: 'text' }>['marks'][number][] = [];

        for (const [tag, mark] of [
          ['b', 'strong'],
          ['i', 'emphasis'],
          ['strike', 'strike']
        ] as const) {
          const property = $(run).find(`w\\:${tag}`);

          if (property.length && !['0', 'false'].includes(property.attr('w:val') ?? ''))
            marks.push(mark);
        }

        const vertical = $(run).find('w\\:vertAlign').attr('w:val');

        if (vertical === 'subscript' || vertical === 'superscript') marks.push(vertical);

        return {
          type: 'text',
          text: $(run)
            .find('w\\:t')
            .map((_, text) => $(text).text())
            .get()
            .join(''),
          marks
        };
      });
  const paragraphText = (paragraph: Element) =>
    $(paragraph)
      .find('w\\:t')
      .map((_, text) => $(text).text())
      .get()
      .join('')
      .trim();
  const readTable = (table: Element): void => {
    let rows: ReturnType<typeof officeRow>[] = [];
    const flushTable = () => {
      if (rows.length)
        blocks.push(
          createBlock({ type: 'table', rows }, { type: 'paragraph', index: blocks.length + 1 })
        );

      rows = [];
    };

    visitChildren(table, 'w:tr', (row) => {
      const repeatHeader = $(row).children('w\\:trPr').children('w\\:tblHeader');
      const header =
        !!repeatHeader.length && !['0', 'false', 'off'].includes(repeatHeader.attr('w:val') ?? '');
      let cells: string[] = [];
      const flushRow = () => {
        if (cells.length) rows.push(officeRow(cells, header));

        cells = [];
      };

      visitChildren(row, 'w:tc', (cell) => {
        let text = '';
        const saveCell = () => {
          cells.push(text.trim());

          text = '';
        };
        const walkCell = (parent: Element): void => {
          $(parent)
            .children()
            .each((_, child) => {
              if (child.tagName === 'w:p') {
                const paragraph = paragraphText(child);

                if (paragraph) text += (text ? ' ' : '') + paragraph;
              } else if (child.tagName === 'w:tbl') {
                saveCell();
                flushRow();
                flushTable();
                readTable(child);
              } else walkCell(child);
            });
        };

        walkCell(cell);
        saveCell();
      });
      flushRow();
    });
    flushTable();
  };
  const hasTitle = body
    .find('w\\:pStyle')
    .toArray()
    .some((style) => $(style).attr('w:val')?.toLowerCase() === 'title');
  const walkBody = (parent: Element): void => {
    $(parent)
      .children()
      .each((_, element) => {
        if (element.tagName === 'w:p') {
          const style = $(element).find('w\\:pStyle').attr('w:val') ?? '';

          const inlines = paragraphInlines(element);
          const level = wordHeadingLevel(style, hasTitle);

          if (inlines.length)
            blocks.push(
              createBlock(
                level ? { type: 'heading', level, inlines } : { type: 'paragraph', inlines },
                { type: 'paragraph', index: blocks.length + 1 }
              )
            );
        } else if (element.tagName === 'w:tbl') readTable(element);
        else walkBody(element);
      });
  };

  walkBody(body[0]);

  return blocks;
}

function presentationSlides(parts: Map<string, string>) {
  const presentation = parts.get('ppt/presentation.xml'),
    rels = parts.get('ppt/_rels/presentation.xml.rels');
  let slides: string[] = [];

  if (!presentation || !rels)
    throw new StudyError('invalid_input', 'Slide presentation relationships are missing');

  if (presentation && rels) {
    const r = parseXml(rels),
      lookup = new Map<string, string>();

    r('Relationship').each((_, e) => {
      const id = r(e).attr('Id'),
        target = r(e).attr('Target'),
        type = r(e).attr('Type');

      if (id && target && type?.endsWith('/slide')) lookup.set(id, targetPart('ppt', target));
    });
    const p = parseXml(presentation);

    p('p\\:sldId').each((_, e) => {
      const id = p(e).attr('r:id'),
        part = id && lookup.get(id);

      if (!part) throw new StudyError('invalid_input', 'Slide relationship is missing');

      slides.push(part);
    });
  }

  if (!slides.length || slides.length > 2000)
    throw new StudyError(
      'invalid_input',
      'Slide deck has no readable slides or exceeds the slide limit'
    );

  return slides;
}

function readPptx(parts: Map<string, string>): {
  blocks: Block[];
  pageCount: number;
} {
  const slides = presentationSlides(parts);

  const blocks: Block[] = [];

  for (const [index, name] of slides.entries()) {
    const xml = parts.get(name);

    if (!xml) throw new StudyError('invalid_input', 'Slide content is missing');

    const $ = parseXml(xml);

    if ($('p\\:sld').length !== 1) throw new StudyError('invalid_input', 'Slide root is missing');

    $('p\\:sld')
      .find('p\\:sp, a\\:tr')
      .each((_, shape) => {
        if (shape.tagName === 'a:tr') {
          const cells = $(shape)
            .children('a\\:tc')
            .map((_, c) =>
              $(c)
                .find('a\\:t')
                .map((_, t) => $(t).text())
                .get()
                .join(' ')
                .trim()
            )
            .get();

          if (cells.some(Boolean))
            blocks.push(tableRow(cells, { type: 'slide', index: index + 1 }));

          return;
        }

        const heading = ['title', 'ctrTitle'].includes($(shape).find('p\\:ph').attr('type') ?? '');

        $(shape)
          .find('a\\:p')
          .each((_, p) => {
            const text = $(p)
              .find('a\\:t')
              .map((_, t) => $(t).text())
              .get()
              .join('')
              .trim();

            if (text)
              blocks.push(
                plainBlock(heading ? 'heading' : 'paragraph', text, {
                  type: 'slide',
                  index: index + 1
                })
              );
          });
      });
    const relName = posix.join(posix.dirname(name), '_rels', posix.basename(name) + '.rels'),
      relationship = parts.get(relName);

    if (relationship) {
      const r = parseXml(relationship);
      let notes: string | undefined;

      r('Relationship').each((_, e) => {
        if (r(e).attr('Type')?.endsWith('/notesSlide')) {
          const target = r(e).attr('Target');

          if (!target) throw new StudyError('invalid_input', 'Notes relationship has no target');

          notes = parts.get(targetPart(posix.dirname(name), target));

          if (!notes) throw new StudyError('invalid_input', 'Slide notes content is missing');
        }
      });

      if (notes) {
        const n = parseXml(notes);

        n('p\\:sp').each((_, shape) => {
          if (n(shape).find('p\\:ph').attr('type') !== 'body') return;

          n(shape)
            .find('a\\:p')
            .each((_, p) => {
              const text = n(p)
                .find('a\\:t')
                .map((_, t) => n(t).text())
                .get()
                .join('')
                .trim();

              if (text)
                blocks.push(plainBlock('paragraph', text, { type: 'slide', index: index + 1 }));
            });
        });
      }
    }
  }

  return { blocks, pageCount: slides.length };
}

export async function decodeOffice(
  input: { kind: 'document' | 'slides'; bytes: Uint8Array },
  signal?: AbortSignal
): Promise<Document> {
  const parts = await xmlParts(input.bytes, signal);

  checkAbort(signal);

  if (input.kind === 'document') {
    const result = document(readDocx(parts), 'office');

    result.meta.omissions = ['formatting', 'embedded_media'];

    if (parseXml(parts.get('word/document.xml')!).root().find('w\\:tbl w\\:tbl').length)
      result.meta.omissions.push('nested_table');

    return result;
  }

  const result = readPptx(parts);

  const doc = document(result.blocks, 'office', result.pageCount);

  doc.meta.omissions = ['formatting', 'embedded_media', 'layout'];

  return doc;
}

function wordHeadingLevel(style: string, hasTitle: boolean) {
  if (style.toLowerCase() === 'title') return 1;

  const outline = /^heading([1-9])?$/i.exec(style);

  if (outline) return Math.min(6, (Number(outline[1]) || 1) + Number(hasTitle));
}

function officeRow(cells: string[], header = false) {
  return {
    cells: cells.map((text) => ({
      header,
      paragraphs: [[{ type: 'text' as const, text, marks: [] }]]
    }))
  };
}

function tableRow(cells: string[], anchor: Anchor): Block {
  return createBlock({ type: 'table', rows: [officeRow(cells)] }, anchor);
}
