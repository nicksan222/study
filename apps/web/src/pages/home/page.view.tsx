import { HomeHub } from '@study/ui/home-hub';
import { Link } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';

const links = [
  ['/sessions', 'Sessions', 'workspace.sessionsHelp'],
  ['/library', 'collections.library', 'workspace.libraryHelp'],
  ['/projects', 'Projects', 'workspace.collectionsHelp']
] as const;

export function PageView({ project }: { project?: string }) {
  const { t } = useI18n();

  return (
    <HomeHub.Root>
      <HomeHub.Header>
        <HomeHub.Title>{t('workspace.start')}</HomeHub.Title>
        <HomeHub.Description>{t('workspace.startHelp')}</HomeHub.Description>
      </HomeHub.Header>
      <HomeHub.Navigation aria-label={t('Home')}>
        {links.map(([to, label, help]) => (
          <HomeHub.Entry key={to} render={<Link to={to} search={{ project }} />}>
            <HomeHub.Label>{t(label)}</HomeHub.Label>
            <HomeHub.Help>{t(help)}</HomeHub.Help>
          </HomeHub.Entry>
        ))}
      </HomeHub.Navigation>
    </HomeHub.Root>
  );
}
