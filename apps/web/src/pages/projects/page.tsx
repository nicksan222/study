import { PageView } from './page.view';
import { usePage } from './use-page';

export function Page() {
  return <PageView {...usePage()} />;
}
