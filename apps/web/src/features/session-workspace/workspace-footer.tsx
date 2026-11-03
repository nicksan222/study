import { CornerDownLeft, Folder } from 'lucide-react';

import { useI18n } from '../../lib/i18n';

export function WorkspaceFooter() {
  const { t } = useI18n();
  return (
    <div className="session-workspace-meta">
      <span>
        <Folder size={14} aria-hidden="true" />
        {t('SessionWorkspaceContext')}
      </span>
      <span>
        <CornerDownLeft size={13} aria-hidden="true" />
        {t('SessionStartShortcut')}
      </span>
    </div>
  );
}
