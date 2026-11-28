import { rpc } from '@study/contracts/react';
import {
  Onboarding,
  OnboardingNotebook,
  OnboardingSetup,
  OnboardingSubject,
  OnboardingPage,
  OnboardingWorkflow
} from '@study/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ReplayContext } from '#client/features/onboarding/index.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import { AiAccountSettings } from '#client/pages/settings/ai/index.tsx';
import { AppearanceStatus } from '#client/pages/settings/appearance-status.tsx';
import { GeneralSettings } from '#client/pages/settings/general/index.tsx';
import { ColorScheme } from '#client/pages/settings/theme-library.tsx';
import { useAppearance } from '#client/pages/settings/use-page.ts';

const slides = [
  { id: 'welcome', title: 'OnboardingWelcomeTitle', description: 'OnboardingWelcomeSimple' },
  { id: 'language', title: 'GeneralSettingsLanguage', description: 'OnboardingLanguageIntro' },
  { id: 'appearance', title: 'ColorScheme', description: 'OnboardingAppearanceIntro' },
  {
    id: 'subjects',
    title: 'OnboardingSubjectsTitle',
    description: 'OnboardingSubjectsDescription'
  },
  { id: 'notes', title: 'OnboardingNotesTitle', description: 'OnboardingNotebookDescription' },
  {
    id: 'pages',
    title: 'OnboardingPagesTitle',
    description: 'OnboardingPagesDescription'
  },
  {
    id: 'workflow',
    title: 'OnboardingWorkflowTitle',
    description: 'OnboardingWorkflowDescription'
  },
  { id: 'ai', title: 'OnboardingConnectTitle', description: 'OnboardingConnectDescription' }
] as const;

/** Persists first-run dismissal and keeps settings replay independent of the saved flag. */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const settings = rpc.settings.appSettings.useQuery({});
  const [replaying, setReplaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState(0);
  const save = rpc.settings.saveAppSettings.useMutation();
  const open = replaying || (!dismissed && settings.data?.onboarded === false);
  const slide = slides[step]!;
  const finish = () => {
    if (!save.isPending && settings.data)
      void save
        .mutate({ ...settings.data, onboarded: true })
        .then(() => {
          setDismissed(true);
          setReplaying(false);
        })
        .catch(() => {});
  };

  return (
    <ReplayContext
      value={() => {
        setStep(0);
        setReplaying(true);
      }}
    >
      {children}
      <Onboarding
        open={open}
        appName={t('AppName')}
        title={t(slide.title)}
        description={t(slide.description)}
        visual={<WelcomeVisual kind={slide.id} />}
        steps={slides.map((item) => t(item.title))}
        step={step}
        backLabel={t('Back')}
        nextLabel={t(nextLabel(step, save.isPending))}
        skipLabel={t('OnboardingSkip')}
        closeLabel={t('Close')}
        pending={save.isPending}
        error={save.isError ? t('OnboardingSaveFailed') : undefined}
        onBack={() => setStep((value) => Math.max(0, value - 1))}
        onNext={() => {
          if (step === slides.length - 1) finish();
          else setStep((value) => value + 1);
        }}
        onClose={finish}
      />
    </ReplayContext>
  );
}

function WelcomeVisual({ kind }: { kind: (typeof slides)[number]['id'] }) {
  const { t } = useI18n();

  if (kind === 'language') return <GeneralSettings showReplay={false} />;

  if (kind === 'appearance') return <Personalize />;

  if (kind === 'subjects' || kind === 'welcome')
    return (
      <OnboardingSubject
        label={t('OnboardingExample')}
        name={t('OnboardingSampleSubject')}
        monogram={t('OnboardingSampleMonogram')}
        notesLabel={t('Notes')}
        note={t('OnboardingSampleNote')}
        pagesLabel={t('SourcePage')}
        page={t('OnboardingSamplePageTitle')}
      />
    );

  if (kind === 'pages')
    return (
      <OnboardingPage
        label={t('OnboardingExamplePage')}
        title={t('OnboardingSamplePageTitle')}
        content={t('OnboardingSamplePageBody')}
      />
    );

  if (kind === 'workflow')
    return (
      <OnboardingWorkflow
        label={t('OnboardingExampleTransformation')}
        note={t('OnboardingSampleEntry')}
        file={t('OnboardingSampleFile')}
        title={t('OnboardingSamplePageTitle')}
        content={t('OnboardingSamplePageBody')}
        transformLabel={t('OnboardingPreviewTransform')}
        captureLabel={t('OnboardingPreviewNotes')}
        pagesLabel={t('SourcePage')}
      />
    );

  if (kind === 'notes')
    return (
      <OnboardingNotebook
        label={t('OnboardingExample')}
        note={t('OnboardingSampleEntry')}
        file={t('OnboardingSampleFile')}
      />
    );

  if (kind === 'ai') return <AiAccountSettings showHeading={false} />;

  return null;
}

function Personalize() {
  const model = useAppearance();

  return (
    <OnboardingSetup>
      <AppearanceStatus model={model} />
      {model.data && <ColorScheme model={model} showHeading={false} />}
    </OnboardingSetup>
  );
}

function nextLabel(step: number, pending: boolean) {
  if (pending) return 'Saving';

  if (step === 0) return 'OnboardingStart';

  if (step === slides.length - 1) return 'OnboardingFinish';

  return 'OnboardingNext';
}
