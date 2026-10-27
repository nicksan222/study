import type { LanguageModelV3 } from '@ai-sdk/provider';

import type { Document } from '#backend/shared/sources/document';
import type { SourceKind } from '#backend/shared/sources/sniff';

export type ReaderKind = 'text' | 'web' | 'office' | 'vision';

export interface SourceInput {
  kind: SourceKind;
  mime: string;
  bytes: Uint8Array;
  name: string;
  url?: string;
}

export interface ReadOptions {
  model?: LanguageModelV3;
  signal?: AbortSignal;
  maxBytes?: number;
}

export interface Reader {
  readonly kind: ReaderKind;
  read(input: SourceInput, options?: ReadOptions): Promise<Document>;
}

export interface Route {
  readonly kind: SourceKind;
  readonly reader: ReaderKind;
  readonly matches: (mime: string) => boolean;
}
