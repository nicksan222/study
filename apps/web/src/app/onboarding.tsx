import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { Onboarding, OnboardingNotebook, OnboardingSetup } from '@study/ui/onboarding';
import {
  OnboardingSubject,
  OnboardingDocument,
  OnboardingWorkflow
} from '@study/ui/onboarding-previews';
import { Settings } from '@study/ui/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ReplayContext } from '#web/features/onboarding/index.tsx';
import { useI18n } from '#web/lib/i18n.tsx';
import { appSettingsQueryOptions } from '#web/lib/study-client/preferences.queries.ts';
import { AiAccountSettings } from '#web/pages/settings/ai/index.tsx';
import { GeneralSettings } from '#web/pages/settings/general/index.tsx';
import { ColorScheme } from '#web/pages/settings/theme-library.tsx';
import { useAppearance } from '#web/pages/settings/use-page.ts';

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
  { id: 'sessions', title: 'OnboardingNotesTitle', description: 'OnboardingNotebookDescription' },
  {
    id: 'documents',
    title: 'OnboardingDocumentsTitle',
    description: 'OnboardingDocumentsDescription'
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
        nextLabel={t(
          save.isPending
            ? 'Saving'
            : step === 0
              ? 'OnboardingStart'
              : step === slides.length - 1
                ? 'OnboardingFinish'
                : 'OnboardingNext'
        )}
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
        sessionsLabel={t('Sessions')}
        session={t('OnboardingSampleSession')}
        documentsLabel={t('SessionSelectionDocuments')}
        document={t('OnboardingSampleDocumentTitle')}
      />
    );

  if (kind === 'documents')
    return (
      <OnboardingDocument
        label={t('OnboardingExampleDocument')}
        title={t('OnboardingSampleDocumentTitle')}
        content={t('OnboardingSampleDocumentBody')}
      />
    );

  if (kind === 'workflow')
    return (
      <OnboardingWorkflow
        label={t('OnboardingExampleTransformation')}
        note={t('OnboardingSampleNote')}
        file={t('OnboardingSampleFile')}
        title={t('OnboardingSampleDocumentTitle')}
        content={t('OnboardingSampleDocumentBody')}
        transformLabel={t('OnboardingPreviewTransform')}
        notesLabel={t('OnboardingPreviewNotes')}
        sessionsLabel={t('Sessions')}
        documentsLabel={t('SessionSelectionDocuments')}
      />
    );

  if (kind === 'sessions')
    return (
      <OnboardingNotebook
        label={t('OnboardingExample')}
        note={t('OnboardingSampleNote')}
        file={t('OnboardingSampleFile')}
      />
    );

  if (kind === 'ai') return <AiAccountSettings showHeading={false} />;

  return null;
}

function Personalize() {
  const model = useAppearance();
  const { t } = useI18n();

  return (
    <OnboardingSetup>
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
      {model.data && <ColorScheme model={model} showHeading={false} />}
    </OnboardingSetup>
  );
}
