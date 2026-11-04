import type { materialContentInputSchema } from '@study/contracts/materials/schemas';
import type { projectIconColors } from '@study/contracts/projects/schemas';
import type { Block, Document } from '@study/contracts/sources/document';

/** Fixture content uses application contracts; creators allocate all durable identities. */
export type SourceFixture = {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly document: Document;
};

export type NoteFixture = {
  readonly title: string;
  readonly description?: string;
  readonly blocks: readonly Block[];
};

export type MaterialFixture = {
  readonly title: string;
  readonly content: typeof materialContentInputSchema.Type;
};

export type Exchange = readonly [question: string, answer: string];

export type ProjectFixture = {
  readonly name: string;
  readonly color: (typeof projectIconColors)[number];
  readonly examInDays: number;
};

export type SeedSummary = {
  projects: number;
  sessions: number;
  sources: number;
  documents: number;
  materials: number;
};
