import type { SessionId } from '@study/contracts/ids';

import { PageView } from './page.view';

export function Page({ id }: { id?: SessionId }) {
  return <PageView id={id} />;
}
