import type { ProjectId } from '@study/contracts/ids';
import { useNavigate, useSearch } from '@tanstack/react-router';

import { PageView } from './page.view';
import type { SettingsSectionId } from './page.view';
import { usePage } from './use-page';

export function Page({
  onClose,
  initialSection,
  initialProject
}: {
  onClose?: () => void;
  initialSection?: SettingsSectionId;
  initialProject?: ProjectId;
}) {
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  return (
    <PageView
      open
      {...usePage(onClose, initialSection)}
      initialProject={initialProject}
      onProjectDeleted={(id) => {
        if (search.project === String(id))
          void navigate({ to: '/sessions', search: {}, replace: true });
      }}
    />
  );
}
