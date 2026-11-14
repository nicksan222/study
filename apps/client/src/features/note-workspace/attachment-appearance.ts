import type { SourceKind } from '@study/contracts/sources/sniff';
import {
  AudioSourceIcon,
  VideoSourceIcon,
  ImageSourceIcon,
  DocumentSourceIcon,
  CodeSourceIcon,
  SpreadsheetSourceIcon,
  SlidesSourceIcon,
  ArchiveSourceIcon,
  WebSourceIcon,
  LinkSourceIcon,
  NoteSourceIcon,
  FileSourceIcon
} from '@study/icons';
import type { IconComponent } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';

type Appearance = {
  icon: IconComponent;
  label: StaticMessageKey;
  tone: 'neutral' | 'blue' | 'violet' | 'amber' | 'teal' | 'red';
};

export const appearances = {
  audio: { icon: AudioSourceIcon, label: 'SourceAudio', tone: 'violet' },
  video: { icon: VideoSourceIcon, label: 'SourceVideo', tone: 'violet' },
  image: { icon: ImageSourceIcon, label: 'SourceImage', tone: 'teal' },
  pdf: { icon: DocumentSourceIcon, label: 'SourcePdf', tone: 'red' },
  text: { icon: DocumentSourceIcon, label: 'SourceText', tone: 'neutral' },
  code: { icon: CodeSourceIcon, label: 'SourceCode', tone: 'blue' },
  document: { icon: DocumentSourceIcon, label: 'SourceDocument', tone: 'blue' },
  spreadsheet: { icon: SpreadsheetSourceIcon, label: 'SourceSpreadsheet', tone: 'teal' },
  slides: { icon: SlidesSourceIcon, label: 'SourceSlides', tone: 'amber' },
  archive: { icon: ArchiveSourceIcon, label: 'SourceArchive', tone: 'amber' },
  web: { icon: WebSourceIcon, label: 'SourceWeb', tone: 'blue' },
  note: { icon: NoteSourceIcon, label: 'SourceNote', tone: 'neutral' },
  link: { icon: LinkSourceIcon, label: 'SourceLink', tone: 'blue' },
  other: { icon: FileSourceIcon, label: 'SourceOther', tone: 'neutral' }
} satisfies Record<SourceKind, Appearance>;

export function attachmentPreviewKind(kind: SourceKind) {
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'file';
}
