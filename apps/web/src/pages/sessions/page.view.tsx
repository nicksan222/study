import type { SessionId } from '@study/contracts/ids';

import { SessionWorkspace } from '#web/features/session-workspace/index.ts';

export function PageView({ id }: { id?: SessionId }) {
  return <SessionWorkspace id={id} />;
}
