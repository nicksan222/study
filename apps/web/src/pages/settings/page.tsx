import { PageView } from './page.view';
import { usePage } from './use-page';

export function Page({ onClose }: { onClose?: () => void }) {
  return <PageView open {...usePage(onClose)} />;
}
