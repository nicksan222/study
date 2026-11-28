import type { SourceKind } from '@study/contracts';
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

export const sourceIcons = {
  audio: AudioSourceIcon,
  video: VideoSourceIcon,
  image: ImageSourceIcon,
  pdf: DocumentSourceIcon,
  text: DocumentSourceIcon,
  code: CodeSourceIcon,
  document: DocumentSourceIcon,
  spreadsheet: SpreadsheetSourceIcon,
  slides: SlidesSourceIcon,
  archive: ArchiveSourceIcon,
  web: WebSourceIcon,
  note: NoteSourceIcon,
  link: LinkSourceIcon,
  other: FileSourceIcon
} satisfies Record<SourceKind, IconComponent>;
