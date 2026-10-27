import type { sources } from '@study/db/schema';

export const sourceKinds = [
  'audio',
  'video',
  'image',
  'pdf',
  'text',
  'code',
  'document',
  'spreadsheet',
  'slides',
  'archive',
  'web',
  'note',
  'link',
  'other'
] as const;

export type SourceKind = (typeof sources.$inferSelect)['kind'];

export type SourceOrigin = (typeof sources.$inferSelect)['origin'];

export interface Detected {
  kind: SourceKind;
  mime: string;
}

const extensions: [string, SourceKind, string][] = [
  ['jpg', 'image', 'image/jpeg'],
  ['jpeg', 'image', 'image/jpeg'],
  ['jfif', 'image', 'image/jpeg'],
  ['png', 'image', 'image/png'],
  ['webp', 'image', 'image/webp'],
  ['gif', 'image', 'image/gif'],
  ['bmp', 'image', 'image/bmp'],
  ['tif', 'image', 'image/tiff'],
  ['tiff', 'image', 'image/tiff'],
  ['svg', 'image', 'image/svg+xml'],
  ['heic', 'image', 'image/heic'],
  ['heic', 'image', 'image/heif'],
  ['avif', 'image', 'image/avif'],
  ['pdf', 'pdf', 'application/pdf'],
  ['txt', 'text', 'text/plain'],
  ['log', 'text', 'text/plain'],
  ['md', 'text', 'text/markdown'],
  ['markdown', 'text', 'text/markdown'],
  ['csv', 'spreadsheet', 'text/csv'],
  ['tsv', 'spreadsheet', 'text/tab-separated-values'],
  ['json', 'code', 'application/json'],
  ['toml', 'code', 'application/toml'],
  ['yaml', 'code', 'application/yaml'],
  ['yml', 'code', 'application/yaml'],
  ['xml', 'code', 'application/xml'],
  ['html', 'code', 'text/html'],
  ['htm', 'code', 'text/html'],
  ['css', 'code', 'text/css'],
  ['rs', 'code', 'text/plain'],
  ['py', 'code', 'text/plain'],
  ['js', 'code', 'text/plain'],
  ['ts', 'code', 'text/plain'],
  ['tsx', 'code', 'text/plain'],
  ['jsx', 'code', 'text/plain'],
  ['go', 'code', 'text/plain'],
  ['c', 'code', 'text/plain'],
  ['h', 'code', 'text/plain'],
  ['cpp', 'code', 'text/plain'],
  ['java', 'code', 'text/plain'],
  ['kt', 'code', 'text/plain'],
  ['swift', 'code', 'text/plain'],
  ['rb', 'code', 'text/plain'],
  ['sql', 'code', 'text/plain'],
  ['sh', 'code', 'text/plain'],
  ['ipynb', 'code', 'application/x-ipynb+json'],
  ['wav', 'audio', 'audio/wav'],
  ['wav', 'audio', 'audio/x-wav'],
  ['mp3', 'audio', 'audio/mpeg'],
  ['flac', 'audio', 'audio/flac'],
  ['flac', 'audio', 'audio/x-flac'],
  ['ogg', 'audio', 'audio/ogg'],
  ['oga', 'audio', 'audio/ogg'],
  ['opus', 'audio', 'audio/opus'],
  ['m4a', 'audio', 'audio/mp4'],
  ['m4a', 'audio', 'audio/m4a'],
  ['alac', 'audio', 'audio/mp4'],
  ['aac', 'audio', 'audio/aac'],
  ['aif', 'audio', 'audio/aiff'],
  ['aiff', 'audio', 'audio/aiff'],
  ['aiff', 'audio', 'audio/x-aiff'],
  ['caf', 'audio', 'audio/x-caf'],
  ['amr', 'audio', 'audio/amr'],
  ['wma', 'audio', 'audio/x-ms-wma'],
  ['mka', 'audio', 'audio/x-matroska'],
  ['mp4', 'video', 'video/mp4'],
  ['m4v', 'video', 'video/mp4'],
  ['m4v', 'video', 'video/x-m4v'],
  ['mov', 'video', 'video/quicktime'],
  ['mkv', 'video', 'video/x-matroska'],
  ['webm', 'video', 'video/webm'],
  ['avi', 'video', 'video/x-msvideo'],
  ['3gp', 'video', 'video/3gpp'],
  ['wmv', 'video', 'video/x-ms-wmv'],
  ['doc', 'document', 'application/msword'],
  ['docx', 'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['odt', 'document', 'application/vnd.oasis.opendocument.text'],
  ['rtf', 'document', 'application/rtf'],
  ['epub', 'document', 'application/epub+zip'],
  ['pages', 'document', 'application/vnd.apple.pages'],
  ['xls', 'spreadsheet', 'application/vnd.ms-excel'],
  ['xlsx', 'spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ods', 'spreadsheet', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['ppt', 'slides', 'application/vnd.ms-powerpoint'],
  ['pptx', 'slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['odp', 'slides', 'application/vnd.oasis.opendocument.presentation'],
  ['key', 'slides', 'application/vnd.apple.keynote'],
  ['zip', 'archive', 'application/zip'],
  ['tar', 'archive', 'application/x-tar'],
  ['gz', 'archive', 'application/gzip'],
  ['tgz', 'archive', 'application/gzip'],
  ['7z', 'archive', 'application/x-7z-compressed'],
  ['rar', 'archive', 'application/vnd.rar'],
  ['bz2', 'archive', 'application/x-bzip2'],
  ['xz', 'archive', 'application/x-xz']
];

export const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

export function viewerExtension(kind: SourceKind, mime: string): string | null {
  if (kind === 'text' || kind === 'code' || kind === 'note') return 'txt';

  if (!['audio', 'video', 'image', 'pdf', 'document', 'spreadsheet', 'slides'].includes(kind))
    return null;

  const found = extensions.find(([, k, m]) => k === kind && m === mime);

  return found && found[0] !== 'svg' ? found[0] : null;
}

function detectedMime(mime: string): Detected {
  const entry = extensions.find(([, , m]) => m === mime);

  if (entry) return { kind: entry[1], mime };

  if (mime.startsWith('image/')) return { kind: 'image', mime };

  if (mime.startsWith('audio/')) return { kind: 'audio', mime };

  if (mime.startsWith('video/')) return { kind: 'video', mime };

  return { kind: 'other', mime };
}

function signature(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  const starts = (hex: string) => b.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));

  if (starts('89504e470d0a1a0a')) return 'image/png';

  if (starts('ffd8ff')) return 'image/jpeg';

  if (starts('474946383761') || starts('474946383961')) return 'image/gif';

  if (starts('424d')) return 'image/bmp';

  if (starts('49492a00') || starts('4d4d002a')) return 'image/tiff';

  if (starts('255044462d')) return 'application/pdf';

  if (starts('504b0304') || starts('504b0506') || starts('504b0708')) return 'application/zip';

  if (starts('1f8b08')) return 'application/gzip';

  if (starts('377abcaf271c')) return 'application/x-7z-compressed';

  if (starts('526172211a07')) return 'application/vnd.rar';

  if (starts('425a68')) return 'application/x-bzip2';

  if (starts('fd377a585a00')) return 'application/x-xz';

  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF') {
    const type = b.toString('ascii', 8, 12);

    if (type === 'WAVE') return 'audio/x-wav';

    if (type === 'WEBP') return 'image/webp';

    if (type === 'AVI ') return 'video/x-msvideo';
  }

  if (starts('664c6143')) return 'audio/x-flac';

  if (starts('4f676753')) return 'audio/ogg';

  if (starts('494433') || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0))
    return 'audio/mpeg';

  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);

    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';

    if (['avif', 'avis'].includes(brand)) return 'image/avif';

    if (brand === 'M4A ') return 'audio/mp4';

    if (brand === 'qt  ') return 'video/quicktime';

    return 'video/mp4';
  }

  if (b.length > 262 && b.toString('ascii', 257, 262) === 'ustar') return 'application/x-tar';

  return null;
}

export function sniff(name: string, head: Uint8Array): Detected {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  const row = extensions.find(([ext]) => ext === extension);
  const named = row && { kind: row[1], mime: row[2] };
  const mime = signature(head);
  const found = mime && detectedMime(mime);

  if (
    found &&
    found.kind !== 'other' &&
    !(
      mime === 'application/zip' &&
      named &&
      ['document', 'spreadsheet', 'slides'].includes(named.kind)
    )
  )
    return found;

  if (named) return named;

  if (head.length && !head.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });

      return { kind: 'text', mime: 'text/plain' };
    } catch {}
  }

  return { kind: 'other', mime: 'application/octet-stream' };
}
