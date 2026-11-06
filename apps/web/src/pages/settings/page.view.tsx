import type { ProjectId } from '@study/contracts/ids';
import { Settings } from '@study/ui/settings';
import { Palette, Settings2, Bot, GraduationCap, Database, Folder, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';

import { ProjectSettings } from '#web/features/collections/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

import { AiSettings } from './ai';
import { AppearanceStatus } from './appearance-status';
import { DataSettings } from './data';
import { GeneralSettings } from './general';
import { SidebarSettings } from './general/sidebar-settings';
import { InterfaceSettings } from './interface-settings';
import { PerformanceSettings } from './performance';
import { StudySettings } from './study';
import { ColorScheme, ThemeLibrary } from './theme-library';
import type { AppearanceModel } from './use-page';
import {
  AiWritingSettings,
  ReadingSettings,
  SessionDisplaySettings,
  WritingSettings
} from './workspace-settings';

export type SettingsSectionId =
  | 'writing'
  | 'general'
  | 'appearance'
  | 'ai'
  | 'study'
  | 'data'
  | 'projects';

const sections = [
  {
    id: 'general',
    label: 'GeneralSettingsTitle',
    Icon: Settings2,
    keywords: [
      'GeneralSettingsLanguage',
      'ReplayOnboarding',
      'WorkspaceSidebarTitle',
      'WorkspaceDensity',
      'WorkspaceTimeFormat',
      'WorkspaceDocumentCounts',
      'SidebarSettledThreshold'
    ]
  },
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: Palette,
    keywords: ['Themes', 'AppearanceContrast', 'GlassOpacity', 'PanelAnimations', 'TextSize']
  },
  {
    id: 'writing',
    label: 'WorkspaceWritingTitle',
    Icon: PenLine,
    keywords: [
      'WorkspaceAutosave',
      'WorkspaceSpellcheck',
      'WorkspaceEditorFont',
      'WorkspaceEnterCapture',
      'WorkspaceExpandDocuments'
    ]
  },
  {
    id: 'study',
    label: 'StudySettingsNavigation',
    Icon: GraduationCap,
    keywords: [
      'StudySettingsTitle',
      'StudySettingsNewCards',
      'QuizSettingsTitle',
      'QuizQuestionCount',
      'QuizQuestionKind',
      'QuizShuffleQuestions',
      'QuizShuffleChoices',
      'QuizGenerateChoices',
      'QuizDifficulty',
      'WorkspaceReadingTitle',
      'WorkspaceReaderFont',
      'WorkspaceExportFormat'
    ]
  },
  {
    id: 'ai',
    label: 'SettingsAi',
    Icon: Bot,
    keywords: [
      'AiSettingsAccount',
      'AiSettingsModels',
      'AiSettingsSignIn',
      'WorkspaceAiDetail',
      'WorkspaceAutoTitles',
      'PerformanceSettingsTitle',
      'PerformanceSettingsParallel',
      'PerformanceSettingsQueue'
    ]
  },
  {
    id: 'projects',
    label: 'ProjectSettingsTitle',
    Icon: Folder,
    keywords: ['ProjectName', 'SubjectIconTitle', 'SubjectSettings']
  },
  {
    id: 'data',
    label: 'DataSettingsTitle',
    Icon: Database,
    keywords: ['DataCreate', 'DataImport', 'DataPreview']
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
  const items = sections.map((item) => ({
    id: item.id,
    label: t(item.label),
    icon: <item.Icon aria-hidden="true" />
  }));

  return (
    <Settings.Navigation
      label={t('Settings')}
      items={items}
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
  const content = {
    projects: <ProjectSettings initialProject={initialProject} onDeleted={onProjectDeleted} />,
    data: <DataSettings />,
    appearance: <AppearanceContent model={model} search={search} />,
    general: (
      <>
        <GeneralSettings />
        <SessionDisplaySettings />
        <SidebarSettings />
      </>
    ),
    writing: <WritingSettings />,
    ai: (
      <>
        <AiSettings />
        <AiWritingSettings />
        <PerformanceSettings />
      </>
    ),
    study: (
      <>
        <StudySettings />
        <ReadingSettings />
      </>
    )
  } satisfies Record<SettingsSectionId, ReactNode>;

  return content[section];
}

function AppearanceContent({ model, search }: { model: AppearanceModel; search: string }) {
  return (
    <>
      <AppearanceStatus model={model} />
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
