import { PDFDocument } from 'pdf-lib';

import { StudyError } from '#server/shared/errors/index';

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
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
