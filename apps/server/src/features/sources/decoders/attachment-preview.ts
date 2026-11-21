/** @file Reads a bounded table from a delimited text attachment. */

import type { SourcePreview } from '@study/contracts';
import { parse } from 'csv-parse/sync';

const maxPreviewRows = 60;

const maxPreviewColumns = 24;

export function delimitedPreview(bytes: Uint8Array, mime: string): SourcePreview {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const delimiter = mime === 'text/tab-separated-values' ? '\t' : ',';

    return previewTable(parseRows(text, delimiter));
  } catch {
    return { kind: 'unavailable', reason: 'invalid' };
  }
}

function parseRows(text: string, delimiter: string): string[][] {
  return parse(text, {
    bom: true,
    delimiter,
    relax_column_count: true,
    max_record_size: 65536,
    to: maxPreviewRows + 1
  });
}

function previewTable(rows: string[][]): SourcePreview {
  const columns = rows.reduce((largest, row) => Math.max(largest, row.length), 0);

  return {
    kind: 'table',
    columns: Math.min(columns, maxPreviewColumns),
    rows: rows.slice(0, maxPreviewRows).map((row) => row.slice(0, maxPreviewColumns)),
    limited: rows.length > maxPreviewRows || columns > maxPreviewColumns
  };
}
