import type { InfiniteData } from '@tanstack/react-query';

import type { materialPage } from './material-library.queries';

export type BrowseSnapshot = {
  project?: string;
  data?: InfiniteData<Awaited<ReturnType<typeof materialPage>>>;
  scroll: number;
};

// Ephemeral navigation memory; server queries remain the authority for material data.
export const libraryReturn = { scroll: 0, row: '', fromReader: false };

export const libraryEntries = new Map<string, { scroll: number; row: string }>();

export const importReturn: { previous: BrowseSnapshot | null } = {
  previous: null
};

export const librarySearches = new Map<string, { text: string; query: string }>();
