import { StudyRpc } from '@study/contracts/rpc';
import { makeStudyClient } from '@study/server/client';
import type { Effect } from 'effect';

import { rpcBaseUrl } from '../host';

export const studyClient = makeStudyClient(StudyRpc, { baseUrl: rpcBaseUrl });

export type StudyClient = Effect.Success<typeof studyClient>;
