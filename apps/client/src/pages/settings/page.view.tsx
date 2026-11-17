import type { ProjectId } from '@study/contracts';
import {
  AppearanceIcon,
  GeneralSettingsIcon,
  FlashcardsIcon,
  DataStorageIcon,
  ProjectIcon,
  WritingIcon,
  SidebarSettingsIcon,
  ReadingIcon,
  AccountIcon,
  OptionsIcon,
  AgentInstructionsIcon,
  GenerateIcon,
  PerformanceIcon,
  AnalyticsIcon,
  QuizSettingsIcon,
  UsageIcon,
  FillBlankIcon,
  OrderingIcon,
  MatchingIcon,
  TrueFalseIcon,
  IntegrationsIcon,
  DownloadIcon
} from '@study/icons';
import type { IconComponent } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';
import { Settings } from '@study/ui';
import type { ReactNode } from 'react';

import { ProjectSettings } from '#client/features/collections/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { AiActivitySettings } from './activity';
import { AiAccountSettings, AiModelSettings } from './ai';
import { AgentRulesSettings } from './ai/agent-rules';
import { AnalyticsSettings } from './analytics';
import { AppearanceStatus } from './appearance-status';
import { DataSettings } from './data';
import { GeneralSettings } from './general';
import { SidebarSettings } from './general/sidebar-settings';
import { IntegrationsSettings } from './integrations';
import { InterfaceSettings } from './interface-settings';
import { PerformanceSettings } from './performance';
import { StudySettings } from './study';
import { QuizSettings } from './study/quiz-settings';
import { ColorScheme, ThemeLibrary } from './theme-library';
import { UpdatesSettings } from './updates';
import { UsageSettings } from './usage';
import type { AppearanceModel } from './use-page';
import {
  AiWritingSettings,
  ReadingSettings,
  NoteDisplaySettings,
  WritingSettings
} from './workspace-settings';

/** Each section owns one settings task; search points to that task's actual destination. */
const sections = [
  {
    id: 'general',
    label: 'GeneralSettingsTitle',
    Icon: GeneralSettingsIcon,
    keywords: ['GeneralSettingsLanguage', 'ReplayOnboarding']
  },
  {
    id: 'updates',
    label: 'Updates',
    Icon: DownloadIcon,
    keywords: ['UpdateCheck', 'UpdateInstall', 'UpdatesMenuSubtitle']
  },
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: AppearanceIcon,
    keywords: ['Themes', 'AppearanceContrast', 'GlassOpacity', 'PanelAnimations', 'TextSize']
  },
  {
    id: 'sidebar',
    label: 'SettingsSidebar',
    Icon: SidebarSettingsIcon,
    keywords: [
      'WorkspaceSidebarTitle',
      'WorkspaceDensity',
      'WorkspaceTimeFormat',
      'WorkspacePageCounts',
      'SidebarSettledThreshold'
    ]
  },
  {
    id: 'writing',
    label: 'WorkspaceWritingTitle',
    Icon: WritingIcon,
    keywords: [
      'WorkspaceAutosave',
      'WorkspaceSpellcheck',
      'WorkspaceEditorFont',
      'WorkspaceEnterCapture',
      'WorkspaceExpandPages'
    ]
  },
  {
    id: 'reading',
    label: 'WorkspaceReadingTitle',
    Icon: ReadingIcon,
    keywords: ['WorkspaceReaderFont', 'WorkspaceExportFormat']
  },
  {
    id: 'account',
    label: 'AiSettingsAccount',
    Icon: AccountIcon,
    keywords: ['AiSettingsChatGpt', 'AiSettingsSignIn', 'AiSettingsSignOut']
  },
  {
    id: 'models',
    label: 'AiSettingsModels',
    Icon: OptionsIcon,
    keywords: ['SettingsAi', 'AiSettingsTiny', 'AiSettingsMedium', 'AiSettingsSmart']
  },
  {
    id: 'instructions',
    label: 'AgentRulesTitle',
    Icon: AgentInstructionsIcon,
    keywords: [
      'AgentRulesPages',
      'AgentRulesTitles',
      'AgentRulesReplies',
      'AgentRulesQuizzes',
      'AgentRulesFlashcards',
      'AgentRulesGrading',
      'AgentRulesTranscription',
      'AgentRulesQuestionDetection'
    ]
  },
  {
    id: 'automation',
    label: 'SettingsAiBehavior',
    Icon: GenerateIcon,
    keywords: [
      'WorkspaceAiTitle',
      'WorkspaceAiDetail',
      'WorkspaceAutoTitles',
      'WorkspaceAutoAnswerQuestions'
    ]
  },
  {
    id: 'activity',
    label: 'AiActivityTitle',
    Icon: GenerateIcon,
    keywords: ['AgentActivityDetails', 'AiActivityDescription']
  },
  {
    id: 'usage',
    label: 'UsageTitle',
    Icon: UsageIcon,
    keywords: ['UsageTokens', 'UsageProvider', 'UsageAgents']
  },
  {
    id: 'analytics',
    label: 'AnalyticsTitle',
    Icon: AnalyticsIcon,
    keywords: ['AnalyticsSearch', 'AnalyticsLevel']
  },
  {
    id: 'performance',
    label: 'SettingsPerformance',
    Icon: PerformanceIcon,
    keywords: [
      'PerformanceSettingsTitle',
      'PerformanceSettingsParallel',
      'PerformanceSettingsQueue'
    ]
  },
  {
    id: 'flashcards',
    label: 'Flashcards',
    Icon: FlashcardsIcon,
    keywords: ['StudySettingsTitle', 'StudySettingsNewCards']
  },
  {
    id: 'quizzes',
    label: 'SettingsQuizzes',
    Icon: QuizSettingsIcon,
    keywords: [
      'QuizSettingsTitle',
      'PracticeFeedbackTiming',
      'PracticeFeedbackTimingHelp',
      'PracticeFeedbackAtEnd',
      'PracticeFeedbackImmediately',
      'QuizQuestionCount',
      'QuizQuestionKind',
      'QuizShuffleQuestions',
      'QuizShuffleChoices',
      'QuizGenerateChoices',
      'QuizDifficulty'
    ]
  },
  {
    id: 'fill_blank',
    label: 'PracticeFillBlank',
    Icon: FillBlankIcon,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'ordering',
    label: 'PracticeOrdering',
    Icon: OrderingIcon,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'matching',
    label: 'PracticeMatching',
    Icon: MatchingIcon,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'true_false',
    label: 'PracticeTrueFalse',
    Icon: TrueFalseIcon,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'projects',
    label: 'ProjectSettingsTitle',
    Icon: ProjectIcon,
    keywords: ['ProjectName', 'SubjectIconTitle', 'SubjectSettings']
  },
  {
    id: 'data',
    label: 'DataSettingsTitle',
    Icon: DataStorageIcon,
    keywords: ['DataCreate', 'DataImport', 'DataPreview']
  },
  {
    id: 'integrations',
    label: 'IntegrationsTitle',
    Icon: IntegrationsIcon,
    keywords: ['IntegrationObsidian', 'IntegrationChooseVault']
  }
] as const satisfies readonly {
  id: string;
  label: StaticMessageKey;
  Icon: IconComponent;
  keywords: readonly StaticMessageKey[];
}[];

export type SettingsSectionId = (typeof sections)[number]['id'];

const navigationGroups = [
  {
    label: 'SettingsGroupWorkspace',
    ids: ['general', 'appearance', 'sidebar', 'writing', 'reading', 'analytics', 'updates']
  },
  {
    label: 'SettingsAi',
    ids: ['account', 'models', 'instructions', 'automation', 'activity', 'usage', 'performance']
  },
  {
    label: 'Practice',
    ids: ['flashcards', 'quizzes', 'fill_blank', 'ordering', 'matching', 'true_false']
  },
  { label: 'SettingsGroupLibrary', ids: ['projects', 'data', 'integrations'] }
] as const satisfies readonly { label: StaticMessageKey; ids: readonly SettingsSectionId[] }[];

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
  const groups = navigationGroups.map((group) => ({
    label: t(group.label),
    items: group.ids.map((id) => {
      const item = sections.find((item) => item.id === id)!;

      return { id: item.id, label: t(item.label), icon: <item.Icon aria-hidden="true" /> };
    })
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
  const content = {
    projects: <ProjectSettings initialProject={initialProject} onDeleted={onProjectDeleted} />,
    data: <DataSettings />,
    integrations: <IntegrationsSettings />,
    appearance: <AppearanceContent model={model} search={search} />,
    general: <GeneralSettings />,
    updates: <UpdatesSettings />,
    sidebar: (
      <>
        <NoteDisplaySettings />
        <SidebarSettings />
      </>
    ),
    writing: <WritingSettings />,
    reading: <ReadingSettings />,
    account: <AiAccountSettings />,
    models: <AiModelSettings />,
    instructions: <AgentRulesSettings />,
    automation: <AiWritingSettings />,
    performance: <PerformanceSettings />,
    analytics: <AnalyticsSettings />,
    usage: <UsageSettings />,
    activity: <AiActivitySettings />,
    flashcards: <StudySettings />,
    quizzes: <QuizSettings />,
    fill_blank: <QuizSettings kind="fill_blank" />,
    ordering: <QuizSettings kind="ordering" />,
    matching: <QuizSettings kind="matching" />,
    true_false: <QuizSettings kind="true_false" />
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
