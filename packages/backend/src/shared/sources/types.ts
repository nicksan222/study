import type { sourceRow } from '#backend/procedures/sources/source';

export type Source = ReturnType<typeof sourceRow>;

export type NewSource = Pick<Source, 'name' | 'kind' | 'mime' | 'origin'> &
  Partial<Pick<Source, 'projectId' | 'uri'>> & { bytes: Uint8Array };
