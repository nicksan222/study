import type { ProjectId } from '@study/contracts/ids';
import type { StaticMessageKey } from '@study/localization';
import { Settings } from '@study/ui/settings';
import {
  Palette,
  Settings2,
  Layers,
  Database,
  Folder,
  PenLine,
  PanelLeft,
  BookOpen,
  UserRound,
  SlidersHorizontal,
  FileText,
  Sparkles,
  Gauge,
  ListChecks,
  ChartNoAxesColumn,
  TextCursorInput,
  ListOrdered,
  Link2,
  Binary,
  Plug
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ProjectSettings } from '#web/features/collections/index.ts';
import { useI18n } from '#web/lib/i18n.tsx';

import { AiAccountSettings, AiModelSettings } from './ai';
import { AgentRulesSettings } from './ai/agent-rules';
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
import { UsageSettings } from './usage';
import type { AppearanceModel } from './use-page';
import {
  AiWritingSettings,
  ReadingSettings,
  SessionDisplaySettings,
  WritingSettings
} from './workspace-settings';

/** Each section owns one settings task; search points to that task's actual destination. */
const sections = [
  {
    id: 'general',
    label: 'GeneralSettingsTitle',
    Icon: Settings2,
    keywords: ['GeneralSettingsLanguage', 'ReplayOnboarding']
  },
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: Palette,
    keywords: ['Themes', 'AppearanceContrast', 'GlassOpacity', 'PanelAnimations', 'TextSize']
  },
  {
    id: 'sidebar',
    label: 'SettingsSidebar',
    Icon: PanelLeft,
    keywords: [
      'WorkspaceSidebarTitle',
      'WorkspaceDensity',
      'WorkspaceTimeFormat',
      'WorkspaceDocumentCounts',
      'SidebarSettledThreshold'
    ]
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
    id: 'reading',
    label: 'WorkspaceReadingTitle',
    Icon: BookOpen,
    keywords: ['WorkspaceReaderFont', 'WorkspaceExportFormat']
  },
  {
    id: 'account',
    label: 'AiSettingsAccount',
    Icon: UserRound,
    keywords: ['AiSettingsChatGpt', 'AiSettingsSignIn', 'AiSettingsSignOut']
  },
  {
    id: 'models',
    label: 'AiSettingsModels',
    Icon: SlidersHorizontal,
    keywords: ['SettingsAi', 'AiSettingsTiny', 'AiSettingsMedium', 'AiSettingsSmart']
  },
  {
    id: 'instructions',
    label: 'AgentRulesTitle',
    Icon: FileText,
    keywords: [
      'AgentRulesDocuments',
      'AgentRulesTitles',
      'AgentRulesReplies',
      'AgentRulesQuizzes',
      'AgentRulesFlashcards',
      'AgentRulesDiagrams',
      'AgentRulesGrading',
      'AgentRulesTranscription',
      'AgentRulesQuestionDetection'
    ]
  },
  {
    id: 'automation',
    label: 'SettingsAiBehavior',
    Icon: Sparkles,
    keywords: [
      'WorkspaceAiTitle',
      'WorkspaceAiDetail',
      'WorkspaceAutoTitles',
      'WorkspaceAutoAnswerQuestions'
    ]
  },
  {
    id: 'usage',
    label: 'UsageTitle',
    Icon: ChartNoAxesColumn,
    keywords: ['UsageTokens', 'UsageProvider', 'UsageAgents']
  },
  {
    id: 'performance',
    label: 'SettingsPerformance',
    Icon: Gauge,
    keywords: [
      'PerformanceSettingsTitle',
      'PerformanceSettingsParallel',
      'PerformanceSettingsQueue'
    ]
  },
  {
    id: 'flashcards',
    label: 'Flashcards',
    Icon: Layers,
    keywords: ['StudySettingsTitle', 'StudySettingsNewCards']
  },
  {
    id: 'quizzes',
    label: 'SettingsQuizzes',
    Icon: ListChecks,
    keywords: [
      'QuizSettingsTitle',
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
    Icon: TextCursorInput,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'ordering',
    label: 'PracticeOrdering',
    Icon: ListOrdered,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'matching',
    label: 'PracticeMatching',
    Icon: Link2,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
  },
  {
    id: 'true_false',
    label: 'PracticeTrueFalse',
    Icon: Binary,
    keywords: ['PracticeSettingsQuestionCount', 'QuizDifficulty']
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
  },
  {
    id: 'integrations',
    label: 'IntegrationsTitle',
    Icon: Plug,
    keywords: ['IntegrationObsidian', 'IntegrationChooseVault']
  }
] as const satisfies readonly {
  id: string;
  label: StaticMessageKey;
  Icon: LucideIcon;
  keywords: readonly StaticMessageKey[];
}[];

export type SettingsSectionId = (typeof sections)[number]['id'];

const navigationGroups = [
  {
    label: 'SettingsGroupWorkspace',
    ids: ['general', 'appearance', 'sidebar', 'writing', 'reading']
  },
  {
    label: 'SettingsAi',
    ids: ['account', 'models', 'instructions', 'automation', 'usage', 'performance']
  },
  {
    label: 'Practice',
    ids: ['flashcards', 'quizzes', 'fill_blank', 'ordering', 'matching', 'true_false']
  },
  { label: 'SettingsGroupLibrary', ids: ['projects', 'data'] }
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
    sidebar: (
      <>
        <SessionDisplaySettings />
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
    usage: <UsageSettings />,
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
