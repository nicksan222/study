import type { ProjectId } from '@study/contracts/ids';

import { PageView } from './page.view';
import type { SettingsSectionId } from './page.view';
import { usePage } from './use-page';

/** Clears workspace scope only when settings deletes the subject currently shown there. */
export function Page({
  onClose,
  initialSection,
  initialProject
}: {
  onClose?: () => void;
  initialSection?: SettingsSectionId;
  initialProject?: ProjectId;
}) {
  return <PageView open {...usePage(onClose, initialSection)} initialProject={initialProject} />;
}
