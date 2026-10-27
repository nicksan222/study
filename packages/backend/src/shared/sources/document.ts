export type BlockKind = 'paragraph' | 'heading' | 'list_item' | 'table' | 'code' | 'segment';

export type Anchor =
  | { type: 'time'; startMs: number; endMs: number }
  | { type: 'page'; page: number }
  | {
      type: 'text';
      lineStart: number;
      lineEnd: number;
      start: number;
      end: number;
    }
  | { type: 'slide' | 'paragraph'; index: number }
  | { type: 'url'; url: string; fragment: string | null };

export interface Block {
  kind: BlockKind;
  text: string;
  anchor: Anchor;
}

export interface Stamp {
  refiner: string;
  version: number;
}

export interface DocumentMeta {
  extractor: string | null;
  extractorVersion: number;
  provider: string | null;
  durationMs: number | null;
  pageCount: number | null;
  refiners: Stamp[];
  waitingFor: string[];
  corrected: boolean;
}

export interface Document {
  blocks: Block[];
  meta: DocumentMeta;
}
