import { posix } from 'node:path';

import { load } from 'cheerio';
import { XMLValidator } from 'fast-xml-parser';
import { fromBufferPromise } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

import { StudyError } from '#backend/shared/errors/index';
import type { Block } from '#backend/shared/sources/document';

import { checkAbort, document } from './common.ts';
import type { Reader } from './types.ts';

const MAX_ENTRIES = 5000,
  MAX_EXPANDED = 32 * 1024 * 1024;

async function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    zip.once('entry', onEntry);
    zip.once('end', onEnd);
    zip.once('error', onError);
    zip.readEntry();
  });
}

async function xmlParts(bytes: Uint8Array, signal?: AbortSignal): Promise<Map<string, string>> {
  let zip: ZipFile | undefined;

  try {
    zip = await fromBufferPromise(Buffer.from(bytes), {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
    const parts = new Map<string, string>();
    let count = 0,
      total = 0;

    for (;;) {
      checkAbort(signal);
      const entry = await nextEntry(zip);

      if (!entry) break;

      if (++count > MAX_ENTRIES)
        throw new StudyError('invalid_input', 'Office archive has too many entries');

      if (!/^(word\/document\.xml|ppt\/.*\.(xml|rels))$/.test(entry.fileName)) continue;

      if (parts.has(entry.fileName))
        throw new StudyError('invalid_input', 'Office archive has duplicate parts');

      total += entry.uncompressedSize;

      if (total > MAX_EXPANDED)
        throw new StudyError('invalid_input', 'Office XML exceeds the size limit');

      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      const abort = () => stream.destroy(new StudyError('cancelled', 'Reading was cancelled'));

      signal?.addEventListener('abort', abort, { once: true });

      try {
        checkAbort(signal);

        for await (const chunk of stream) {
          size += chunk.length;

          if (size > entry.uncompressedSize || size > MAX_EXPANDED)
            throw new StudyError('invalid_input', 'Office XML exceeds the size limit');

          chunks.push(chunk);
        }
      } finally {
        signal?.removeEventListener('abort', abort);
        stream.destroy();
      }

      parts.set(
        entry.fileName,
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      );
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

  const push = (kind: Block['kind'], text: string) => {
    if (text)
      blocks.push({
        kind,
        text,
        anchor: { type: 'paragraph', index: blocks.length + 1 }
      });
  };
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
  const paragraphText = (paragraph: Element) =>
    $(paragraph)
      .find('w\\:t')
      .map((_, text) => $(text).text())
      .get()
      .join('')
      .trim();
  const readTable = (table: Element): void => {
    visitChildren(table, 'w:tr', (row) => {
      let cells: string[] = [];
      const flush = () => {
        if (cells.some(Boolean)) push('table', cells.join(' | '));

        cells = [];
      };

      visitChildren(row, 'w:tc', (cell) => {
        let text = '';
        const saveCell = () => {
          if (text.trim()) cells.push(text.trim());

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
                flush();
                readTable(child);
              } else walkCell(child);
            });
        };

        walkCell(cell);
        saveCell();
      });
      flush();
    });
  };
  const walkBody = (parent: Element): void => {
    $(parent)
      .children()
      .each((_, element) => {
        if (element.tagName === 'w:p') {
          const style = $(element).find('w\\:pStyle').attr('w:val') ?? '';

          push(/^heading[1-9]?$/i.test(style) ? 'heading' : 'paragraph', paragraphText(element));
        } else if (element.tagName === 'w:tbl') readTable(element);
        else walkBody(element);
      });
  };

  walkBody(body[0]);

  return blocks;
}

function readPptx(parts: Map<string, string>): {
  blocks: Block[];
  pageCount: number;
} {
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
            blocks.push({
              kind: 'table',
              text: cells.join(' | '),
              anchor: { type: 'slide', index: index + 1 }
            });

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
              blocks.push({
                kind: heading ? 'heading' : 'paragraph',
                text,
                anchor: { type: 'slide', index: index + 1 }
              });
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
                blocks.push({
                  kind: 'paragraph',
                  text,
                  anchor: { type: 'slide', index: index + 1 }
                });
            });
        });
      }
    }
  }

  return { blocks, pageCount: slides.length };
}

export const officeReader: Reader = {
  kind: 'office',
  async read(input, options) {
    const parts = await xmlParts(input.bytes, options?.signal);

    checkAbort(options?.signal);

    if (input.kind === 'document') return document(readDocx(parts), 'office');

    const result = readPptx(parts);

    return document(result.blocks, 'office', result.pageCount);
  }
};
