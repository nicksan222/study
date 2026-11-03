import type { ProjectId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { Palette, Settings2, Bot, GraduationCap, Gauge, Database, Folder } from 'lucide-react';

import { ProjectSettings } from '../../features/collections';
import { useI18n } from '../../lib/i18n';
import { AiSettings } from './ai';
import { DataSettings } from './data';
import { GeneralSettings } from './general';
import { InterfaceSettings } from './interface-settings';
import { PerformanceSettings } from './performance';
import { StudySettings } from './study';
import { ColorScheme, ThemeLibrary } from './theme-library';
import type { AppearanceModel } from './use-page';

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'ai'
  | 'study'
  | 'performance'
  | 'data'
  | 'projects';

const sections = [
  {
    id: 'projects',
    group: 'SettingsGroupLearning',
    label: 'ProjectSettingsTitle',
    Icon: Folder,
    keywords: ['ProjectName', 'SubjectIconTitle', 'SubjectSettings']
  },
  {
    id: 'general',
    group: 'SettingsGroupApplication',
    label: 'GeneralSettingsTitle',
    Icon: Settings2,
    keywords: ['GeneralSettingsLanguage']
  },
  {
    id: 'appearance',
    group: 'SettingsGroupApplication',
    label: 'Appearance',
    Icon: Palette,
    keywords: ['Themes', 'AppearanceContrast', 'GlassOpacity', 'PanelAnimations', 'TextSize']
  },
  {
    id: 'data',
    group: 'SettingsGroupApplication',
    label: 'DataSettingsTitle',
    Icon: Database,
    keywords: ['DataCreate', 'DataImport', 'DataPreview']
  },
  {
    id: 'ai',
    group: 'SettingsGroupIntelligence',
    label: 'SettingsAi',
    Icon: Bot,
    keywords: ['AiSettingsAccount', 'AiSettingsModels', 'AiSettingsSignIn']
  },
  {
    id: 'study',
    group: 'SettingsGroupLearning',
    label: 'StudySettingsNavigation',
    Icon: GraduationCap,
    keywords: ['StudySettingsTitle', 'StudySettingsNewCards']
  },
  {
    id: 'performance',
    group: 'SettingsGroupIntelligence',
    label: 'PerformanceSettingsTitle',
    Icon: Gauge,
    keywords: ['PerformanceSettingsParallel', 'PerformanceSettingsQueue']
  }
] as const;

/** Composes settings navigation and passes subject identity and committed deletion outcomes to its section. */
export function PageView({
  open,
  onClose,
  model,
  search = '',
  onSearch,
  section = 'appearance',
  onSectionChange,
  initialProject,
  onProjectDeleted
}: {
  open: boolean;
  onClose: () => void;
  model: AppearanceModel;
  search?: string;
  onSearch?: (value: string) => void;
  section?: SettingsSectionId;
  onSectionChange?: (section: SettingsSectionId) => void;
  initialProject?: ProjectId;
  onProjectDeleted?: (id: ProjectId) => void;
}) {
  const { t } = useI18n();
  const current = sections.find((item) => item.id === section)!;

  return (
    <Settings.Root
      open={open}
      onClose={onClose}
      title={t('Settings')}
      section={t(current.label)}
      icon={<current.Icon aria-hidden="true" />}
      closeLabel={t('Close')}
      navigation={
        onSectionChange && (
          <SettingsNavigation section={section} onSectionChange={onSectionChange} />
        )
      }
      search={
        onSearch && (
          <Settings.Search
            label={t('SearchSettings')}
            placeholder={t('Search')}
            value={search}
            onChange={onSearch}
          />
        )
      }
    >
      {search.trim() && onSectionChange ? (
        <SearchContent search={search} model={model} onSectionChange={onSectionChange} />
      ) : (
        <SectionContent
          section={section}
          model={model}
          search={search}
          initialProject={initialProject}
          onProjectDeleted={onProjectDeleted}
        />
      )}
    </Settings.Root>
  );
}

function SettingsNavigation({
  section,
  onSectionChange
}: {
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
}) {
  const { t } = useI18n();
  const groups = (
    ['SettingsGroupApplication', 'SettingsGroupLearning', 'SettingsGroupIntelligence'] as const
  ).map((group) => ({
    label: t(group),
    items: sections
      .filter((item) => item.group === group)
      .map((item) => ({
        id: item.id,
        label: t(item.label),
        icon: <item.Icon aria-hidden="true" />
      }))
  }));

  return (
    <Settings.Navigation
      label={t('Settings')}
      groups={groups}
      value={section}
      onValueChange={onSectionChange}
    />
  );
}

/** Groups matching settings entries and exposes an empty state when none match. */
function SearchContent({
  search,
  model,
  onSectionChange
}: {
  search: string;
  model: AppearanceModel;
  onSectionChange: (section: SettingsSectionId) => void;
}) {
  const { t } = useI18n();
  const query = search.trim().toLocaleLowerCase();
  const matches = sections.filter((item) =>
    [t(item.label), ...item.keywords.map((key) => t(key))].some((label) =>
      label.toLocaleLowerCase().includes(query)
    )
  );
  const themeMatch = model.data?.themes.some((theme) =>
    theme.name.toLocaleLowerCase().includes(query)
  );

  return (
    <>
      {(matches.length > 0 || !themeMatch) && (
        <Settings.SearchResults
          title={t('SettingsSearchMatches')}
          items={matches.map((item) => ({
            id: item.id,
            label: t(item.label),
            icon: <item.Icon aria-hidden="true" />
          }))}
          empty={t('SearchNoResults')}
          onSelect={onSectionChange}
        />
      )}
      {themeMatch && <ThemeLibrary model={model} search={search} />}
    </>
  );
}

/** Selects the feature-owned settings surface without copying feature state into the shell. */
function SectionContent({
  section,
  model,
  search,
  initialProject,
  onProjectDeleted
}: {
  section: SettingsSectionId;
  model: AppearanceModel;
  search: string;
  initialProject?: ProjectId;
  onProjectDeleted?: (id: ProjectId) => void;
}) {
  switch (section) {
    case 'projects':
      return <ProjectSettings initialProject={initialProject} onDeleted={onProjectDeleted} />;
    case 'data':
      return <DataSettings />;
    case 'appearance':
      return <AppearanceContent model={model} search={search} />;
    case 'general':
      return <GeneralSettings />;
    case 'ai':
      return <AiSettings />;
    case 'performance':
      return <PerformanceSettings />;
    case 'study':
      return <StudySettings />;
  }
}

function AppearanceContent({ model, search }: { model: AppearanceModel; search: string }) {
  const { t } = useI18n();

  return (
    <>
      {model.loading && <Loading label={t('LoadingSettings')} />}
      {model.error && (
        <Settings.Status
          action={
            <Button variant="outline" onClick={model.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {t('AppearanceFailed')}
        </Settings.Status>
      )}
      {model.data && (
        <>
          <ColorScheme model={model} />
          <ThemeLibrary model={model} search={search} />
          <InterfaceSettings model={model} />
        </>
      )}
    </>
  );
}
