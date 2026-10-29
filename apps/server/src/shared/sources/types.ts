import type { SourceId } from '#server/shared/ids';

import type { Source as SourceDto } from './schemas.ts';

export type Source = Omit<SourceDto, 'id'> & { id: SourceId };

export type NewSource = Pick<Source, 'name' | 'kind' | 'mime' | 'origin'> &
  Partial<Pick<Source, 'projectId' | 'uri'>> & { bytes: Uint8Array };
