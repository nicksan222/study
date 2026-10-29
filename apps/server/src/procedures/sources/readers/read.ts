import { StudyError } from '#server/shared/errors/index';

import { checkInput, DEFAULT_MAX_BYTES } from './common.ts';
import { webReader } from './html.ts';
import { officeReader } from './office.ts';
import { textReader } from './text.ts';
import type { ReadOptions, Reader, Route, SourceInput } from './types.ts';
import { visionReader } from './vision.ts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const any = () => true;

export const ROUTES: readonly Route[] = [
  { kind: 'web', reader: 'web', matches: any },
  { kind: 'code', reader: 'web', matches: (mime) => mime === 'text/html' },
  { kind: 'code', reader: 'text', matches: any },
  { kind: 'text', reader: 'text', matches: any },
  { kind: 'note', reader: 'text', matches: any },
  {
    kind: 'spreadsheet',
    reader: 'text',
    matches: (mime) => mime.startsWith('text/')
  },
  { kind: 'document', reader: 'office', matches: (mime) => mime === DOCX },
  { kind: 'slides', reader: 'office', matches: (mime) => mime === PPTX },
  {
    kind: 'pdf',
    reader: 'vision',
    matches: (mime) => mime === 'application/pdf'
  },
  {
    kind: 'image',
    reader: 'vision',
    matches: (mime) => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)
  }
];

const readers: Record<Route['reader'], Reader> = {
  text: textReader,
  web: webReader,
  office: officeReader,
  vision: visionReader
};

export function readerFor(input: Pick<SourceInput, 'kind' | 'mime'>): Reader {
  const route = ROUTES.find(
    (candidate) => candidate.kind === input.kind && candidate.matches(input.mime)
  );

  if (!route) throw new StudyError('unsupported', 'No reader supports this source');

  return readers[route.reader];
}

export async function readSource(input: SourceInput, options: ReadOptions = {}) {
  checkInput(input.bytes, options.maxBytes ?? DEFAULT_MAX_BYTES, options.signal);

  return readerFor(input).read(input, options);
}
