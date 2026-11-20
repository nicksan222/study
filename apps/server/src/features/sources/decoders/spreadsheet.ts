/** @file Extracts ordered worksheet contents into the canonical anchored document. */

import { StudyError, createBlock, plainBlock } from '@study/contracts';
import type { Block, Document, Inline } from '@study/contracts';
import { load } from 'cheerio';
import { zipSync } from 'fflate';
import { read, utils } from 'xlsx';
import type { CellObject, WorkSheet } from 'xlsx';

import { DEFAULT_MAX_BYTES, checkAbort, checkInput, document } from './common.ts';
import { nextZipEntry, openZip, readZipXml } from './zip.ts';

const maxArchiveEntries = 5000;

const maxExpandedBytes = 16 * 1024 * 1024;

const maxCells = 100_000;

const maxRows = 10_000;

const maxTextLength = 4 * 1024 * 1024;

type TextInline = Extract<Inline, { type: 'text' }>;

type Mark = TextInline['marks'][number];

const richTextMarks = new Map<string, Mark>([
  ['b', 'strong'],
  ['i', 'emphasis'],
  ['s', 'strike'],
  ['sub', 'subscript'],
  ['sup', 'superscript']
]);

function reserveXmlCells(xml: string, remaining: number) {
  for (const _cell of xml.matchAll(/<(?:\w+:)?c(?=[\s/>])/g)) {
    if (--remaining < 0) throw new StudyError('invalid_input', 'Excel workbook has too many cells');
  }

  return remaining;
}

/** Hand the workbook parser only streamed, size-checked parts in a fresh archive. */
async function workbookArchive(bytes: Uint8Array, signal?: AbortSignal) {
  const zip = await openZip(bytes);
  const parts = new Map<string, Uint8Array>();
  let total = 0;
  let cellsRemaining = maxCells;

  try {
    if (zip.entryCount > maxArchiveEntries)
      throw new StudyError('invalid_input', 'Excel archive has too many entries');

    for (;;) {
      checkAbort(signal);
      const entry = await nextZipEntry(zip);

      if (!entry) break;

      if (entry.fileName !== '[Content_Types].xml' && !/^xl\/.*\.(xml|rels)$/i.test(entry.fileName))
        continue;

      if (parts.has(entry.fileName))
        throw new StudyError('invalid_input', 'Excel archive has duplicate parts');

      total += entry.uncompressedSize;

      if (total > maxExpandedBytes)
        throw new StudyError('invalid_input', 'Excel archive exceeds the expanded size limit');

      const xml = await readZipXml(zip, entry, maxExpandedBytes, signal);

      cellsRemaining = reserveXmlCells(xml, cellsRemaining);

      // Hyperlink metadata can cover a rectangular range of otherwise absent cells.
      // Keep cell contents and avoid materializing those ranges in the workbook parser.
      const data = xml.replace(/<(?:\w+:)?hyperlink\b[^<>]*>|<\/(?:\w+:)?hyperlink\s*>/g, '');

      parts.set(entry.fileName, new TextEncoder().encode(data));
    }

    if (!parts.has('[Content_Types].xml') || !parts.has('xl/workbook.xml'))
      throw new StudyError('invalid_input', 'Excel workbook parts are missing');

    return zipSync(Object.fromEntries(parts), { level: 0 });
  } finally {
    zip.close();
  }
}

function cellInlines(cell: CellObject | undefined, text: string): TextInline[] {
  const plain: TextInline[] = [{ type: 'text', text, marks: [] }];

  if (cell?.t !== 's' || !cell.h?.includes('<span')) return plain;

  if (cell.h.length > text.length * 256 + 1024) return plain;

  // SheetJS produces an HTML representation of rich runs. Only canonical marks
  // and literal text can cross into the document.
  const $ = load(cell.h, {}, false);
  const formatted: TextInline[] = [];
  const root = $.root();

  type Node = ReturnType<typeof root.contents> extends Iterable<infer T> ? T : never;

  function visit(node: Node, marks: readonly Mark[], depth: number) {
    if (depth > 12) return;

    if (node.type === 'text') {
      formatted.push({ type: 'text', text: node.data, marks });
    } else if (node.type === 'tag') {
      if (node.name === 'br') {
        formatted.push({ type: 'text', text: '\n', marks });

        return;
      }

      const mark = richTextMarks.get(node.name);
      const active = mark && !marks.includes(mark) ? [...marks, mark] : marks;

      node.children.forEach((child) => visit(child, active, depth + 1));
    }
  }

  root.contents().each((_, node) => visit(node, [], 0));

  return formatted.map((inline) => inline.text).join('') === text ? formatted : plain;
}

type SheetRow = Map<number, CellObject>;

function sheetRows(sheet: WorkSheet): Map<number, SheetRow> {
  const rows = new Map<number, SheetRow>();

  for (const [key, value] of Object.entries(sheet)) {
    if (key.startsWith('!')) continue;

    if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(key))
      throw new StudyError('invalid_input', 'Excel worksheet has an invalid cell address');

    const { r: row, c: column } = utils.decode_cell(key);

    if (row >= 1_048_576 || column >= 16_384)
      throw new StudyError('invalid_input', 'Excel worksheet has an invalid cell address');

    const cells = rows.get(row) ?? new Map<number, CellObject>();

    cells.set(column, value);
    rows.set(row, cells);
  }

  return rows;
}

function displayText(cell?: CellObject) {
  if (!cell || cell.t === 'z') return '';

  return cell.w ?? String(cell.v ?? '');
}

function worksheetRow(row: SheetRow, width: number, budget: { text: number }) {
  const cells = Array.from({ length: width }, (_, column) => {
    const cell = row.get(column);
    const text = displayText(cell);

    budget.text -= text.length;

    if (budget.text < 0)
      throw new StudyError('invalid_input', 'Excel workbook exceeds the extracted text limit');

    return { header: false, paragraphs: [cellInlines(cell, text)] };
  });

  return { cells };
}

function workbookBlocks(workbook: ReturnType<typeof read>, signal?: AbortSignal): Block[] {
  const blocks: Block[] = [];
  const anchor = () => ({ type: 'paragraph' as const, index: blocks.length + 1 });
  const budget = { cells: maxCells, rows: maxRows, text: maxTextLength };

  for (const name of workbook.SheetNames) {
    checkAbort(signal);
    const sheet = Object.hasOwn(workbook.Sheets, name) ? workbook.Sheets[name] : undefined;

    if (!sheet) throw new StudyError('invalid_input', 'Excel worksheet is missing');

    blocks.push(plainBlock('heading', name, anchor()));

    const rows = [...sheetRows(sheet)].toSorted(([left], [right]) => left - right);

    if (!rows.length) continue;

    // One table per worksheet keeps column positions aligned across rows.
    const width = rows.reduce((largest, [, row]) => Math.max(largest, ...row.keys()), 0) + 1;

    budget.rows -= rows.length;
    budget.cells -= width * rows.length;

    if (budget.rows < 0 || budget.cells < 0)
      throw new StudyError('invalid_input', 'Excel workbook exceeds the worksheet size limit');

    const content = rows.map(([, row]) => {
      checkAbort(signal);

      return worksheetRow(row, width, budget);
    });

    blocks.push(createBlock({ type: 'table', rows: content }, anchor()));
  }

  return blocks;
}

export async function decodeSpreadsheet(
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<Document> {
  checkInput(bytes, DEFAULT_MAX_BYTES, signal);

  try {
    const archive = await workbookArchive(bytes, signal);

    checkAbort(signal);
    const workbook = read(archive, {
      type: 'array',
      dense: false,
      cellFormula: false,
      cellHTML: true,
      sheetStubs: true
    });

    if (workbook.bookType !== 'xlsx' || !workbook.SheetNames.length)
      throw new StudyError('invalid_input', 'Excel workbook has no worksheets');

    const result = document(workbookBlocks(workbook, signal), 'office');

    result.meta.omissions = ['formatting', 'embedded_media', 'layout'];

    return result;
  } catch (cause) {
    if (cause instanceof StudyError) throw cause;

    throw new StudyError('invalid_input', 'Invalid Excel workbook', { cause });
  }
}
