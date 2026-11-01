/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates PDF readability and page count before source processing delegates page   │
 * │ transcription.                                                                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Source decoders convert bounded input bytes into canonical document data.              │
 * │ - Validates format input and constructs decoded content.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Does not choose ingestion policy or persist source state.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { PDFDocument } from 'pdf-lib';

export async function decodePdf(bytes: Uint8Array): Promise<number> {
  let count: number;

  try {
    count = (await PDFDocument.load(bytes)).getPageCount();
  } catch (cause) {
    throw new StudyError('invalid_input', 'Cannot read PDF pages', { cause });
  }

  if (count < 1 || count > 2000)
    throw new StudyError('invalid_input', 'PDF has no pages or exceeds the page limit');

  return count;
}
