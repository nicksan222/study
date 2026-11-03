import type { SourceKind } from '@study/contracts/sources/sniff';
import type { StaticMessageKey } from '@study/localization';
import {
  AudioLines,
  Film,
  Image,
  FileText,
  FileCode2,
  FileSpreadsheet,
  Presentation,
  Archive,
  Globe2,
  Link2,
  StickyNote,
  File
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Appearance = {
  icon: LucideIcon;
  label: StaticMessageKey;
  tone: 'neutral' | 'blue' | 'violet' | 'amber' | 'teal' | 'red';
};

export const appearances = {
  audio: { icon: AudioLines, label: 'SourceAudio', tone: 'violet' },
  video: { icon: Film, label: 'SourceVideo', tone: 'violet' },
  image: { icon: Image, label: 'SourceImage', tone: 'teal' },
  pdf: { icon: FileText, label: 'SourcePdf', tone: 'red' },
  text: { icon: FileText, label: 'SourceText', tone: 'neutral' },
  code: { icon: FileCode2, label: 'SourceCode', tone: 'blue' },
  document: { icon: FileText, label: 'SourceDocument', tone: 'blue' },
  spreadsheet: { icon: FileSpreadsheet, label: 'SourceSpreadsheet', tone: 'teal' },
  slides: { icon: Presentation, label: 'SourceSlides', tone: 'amber' },
  archive: { icon: Archive, label: 'SourceArchive', tone: 'amber' },
  web: { icon: Globe2, label: 'SourceWeb', tone: 'blue' },
  note: { icon: StickyNote, label: 'SourceNote', tone: 'neutral' },
  link: { icon: Link2, label: 'SourceLink', tone: 'blue' },
  other: { icon: File, label: 'SourceOther', tone: 'neutral' }
} satisfies Record<SourceKind, Appearance>;

export function attachmentPreviewKind(kind: SourceKind) {
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'file';
}
