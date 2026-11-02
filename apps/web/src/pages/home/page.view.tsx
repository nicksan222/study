import { Link, useSearch } from '@tanstack/react-router';
import { useI18n } from '../../lib/i18n';

export function PageView() {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-8 md:py-14">
    <div className="space-y-2"><h2 className="text-2xl font-semibold tracking-tight">{t('workspace.start')}</h2><p className="max-w-prose text-sm text-muted-foreground">{t('workspace.startHelp')}</p></div>
    <nav className="divide-y divide-border" aria-label={t('Home')}>
      {([['/sessions', 'Sessions', 'workspace.sessionsHelp'], ['/library', 'collections.library', 'workspace.libraryHelp'], ['/projects', 'Projects', 'workspace.collectionsHelp']] as const).map(([to, label, help]) => <Link key={to} to={to} search={{ project: search.project }} className="group flex flex-col gap-1 rounded-md px-3 py-5 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-2"><span className="font-semibold">{t(label)}</span><span className="text-muted-foreground">{t(help)}</span></Link>)}
    </nav>
  </div>;
}
