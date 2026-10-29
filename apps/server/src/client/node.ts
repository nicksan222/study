import { EventSource } from 'eventsource';

import { createStudyClient as createClient } from './index.ts';
import type { StudyClientOptions } from './index.ts';
export type { StudyClient, StudyClientOptions } from './index.ts';

export function createStudyClient(options: StudyClientOptions) {
  return createClient({
    ...options,
    EventSource: options.EventSource ?? EventSource
  });
}
