import { Onboarding, OnboardingNotebook, OnboardingSetup } from '@study/ui/onboarding';
import {
  OnboardingSubject,
  OnboardingPage,
  OnboardingWorkflow
} from '@study/ui/onboarding-previews';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ReplayContext } from '#client/features/onboarding/index.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import { appSettingsQueryOptions } from '#client/lib/study-client/preferences.queries.ts';
import { AiAccountSettings } from '#client/pages/settings/ai/index.tsx';
import { AppearanceStatus } from '#client/pages/settings/appearance-status.tsx';
import { GeneralSettings } from '#client/pages/settings/general/index.tsx';
import { ColorScheme } from '#client/pages/settings/theme-library.tsx';
import { useAppearance } from '#client/pages/settings/use-page.ts';

import { onboardingMutationOptions } from './onboarding.queries';

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
  const cache = useQueryClient();
  const settings = useQuery(appSettingsQueryOptions());
  const [replaying, setReplaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState(0);
  const save = useMutation({
    ...onboardingMutationOptions(),
    onSuccess: async () => {
      setDismissed(true);
      setReplaying(false);
      await cache.invalidateQueries({ queryKey: appSettingsQueryOptions().queryKey });
      await cache.invalidateQueries({ queryKey: ['appearance'] });
    }
  });
  const open = replaying || (!dismissed && settings.data?.onboarded === false);
  const slide = slides[step]!;
  const finish = () => {
    if (!save.isPending) save.mutate();
  };

  return (
    <ReplayContext
      value={() => {
        save.reset();
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
        pagesLabel={t('NoteSelectionPages')}
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
        pagesLabel={t('NoteSelectionPages')}
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
