import type { SessionId } from '@study/contracts/ids';

import { SessionWorkspace } from '../../features/session-workspace';

export function PageView({ id }: { id?: SessionId }) {
  return <SessionWorkspace id={id} />;
}
