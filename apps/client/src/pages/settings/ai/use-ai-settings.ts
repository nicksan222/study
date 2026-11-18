import type { signInAttemptSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { prepareSignInBrowser, signInOptions } from '#client/lib/host.ts';
import type { SignInBrowser } from '#client/lib/host.ts';
import type { AiConfiguration } from '#client/lib/study-client/ai-settings.ts';

import { useProviderSettings } from './use-provider-settings';

type SignInAttempt = typeof signInAttemptSchema.Type;

export function useAiSettings() {
  const status = rpc.auth.status.useQuery({});
  const providers = rpc.auth.providers.useQuery({});
  const settings = rpc.settings.llmSettings.useQuery({});
  const catalogQuery = rpc.settings.modelCatalog.useQuery({});
  const catalog = catalogQuery.data;
  const data = configurationData(status.data, providers.data, settings.data);
  const [attempt, setAttempt] = useState<SignInAttempt>();
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [startError, setStartError] = useState<unknown>();
  const [browserError, setBrowserError] = useState(false);
  const browser = useRef<SignInBrowser | undefined>(undefined);
  const owned = useRef<SignInAttempt | undefined>(undefined);
  const mounted = useRef(true);
  const start = rpc.auth.startSignIn.useMutation();
  const finish = rpc.auth.finishSignIn.useMutation();
  const cancel = rpc.auth.cancelSignIn.useMutation();
  const signOut = rpc.auth.signOut.useMutation();
  const models = useProviderSettings(data);

  function closeBrowser() {
    browser.current?.close();
    browser.current = undefined;
  }

  const cancelOwned = useEffectEvent(() => {
    if (owned.current)
      void cancel.mutateAsync({ attemptId: owned.current.attemptId }).catch(() => {});
  });

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      closeBrowser();

      cancelOwned();
    };
  }, []);
  const queries = [status, providers, settings];
  const mutations = [start, finish, cancel, signOut];

  return {
    data,
    catalog: catalog?.models,
    catalogError: catalogQuery.isError,
    retryCatalog: catalogQuery.retry,
    suggestions: catalog?.suggestions,
    recommendations: catalog?.recommendations,
    signInUnsupported: unsupported(start.error) || unsupported(startError),
    loading: queries.some((query) => query.isPending),
    pending: [
      start.isPending,
      attempt !== undefined && finish.isPending,
      cancel.isPending,
      signOut.isPending,
      models.pending
    ].some(Boolean),
    error:
      queries.some((query) => query.isError || query.stale) ||
      mutations.some((mutation) => mutation.isError) ||
      models.error ||
      browserError,
    cancelling: cancel.isPending,
    attempt,
    popupBlocked,
    retry: () => {
      mutations.forEach((mutation) => mutation.reset());
      models.retry();
      setBrowserError(false);
      queries.forEach((query) => query.refetch());
    },
    start: () => {
      finish.reset();
      cancel.reset();
      setBrowserError(false);
      setStartError(undefined);
      browser.current = prepareSignInBrowser();
      setPopupBlocked(false);
      let options: ReturnType<typeof signInOptions>;

      try {
        options = signInOptions();
      } catch (error) {
        setStartError(error);
        closeBrowser();

        return;
      }

      void start
        .mutateAsync(options)
        .then(async (value) => {
          if (!mounted.current) {
            await cancel.mutateAsync({ attemptId: value.attemptId });

            return;
          }

          owned.current = value;

          try {
            const opened = (await browser.current?.open(value.url)) ?? false;

            if (!mounted.current || owned.current !== value) return;

            setAttempt(value);
            setPopupBlocked(!opened);
            await finish.mutateAsync({ attemptId: value.attemptId });
          } catch {
            if (owned.current === value) setBrowserError(true);

            await cancel.mutateAsync({ attemptId: value.attemptId }).catch(() => {});
          } finally {
            if (owned.current === value) {
              owned.current = undefined;

              if (mounted.current) setAttempt(undefined);

              closeBrowser();
            }
          }
        })
        .catch(() => {
          owned.current = undefined;
          closeBrowser();
        });
    },
    cancel: () => {
      if (!attempt) return;

      void cancel
        .mutateAsync({ attemptId: attempt.attemptId })
        .then(() => {
          owned.current = undefined;
          setAttempt(undefined);
          closeBrowser();
          finish.reset();
          start.reset();
        })
        .catch(() => {});
    },
    signOut: () => {
      void signOut.mutateAsync({}).catch(() => {});
    },
    credentialProvider: models.credentialProvider,
    selectCredentialProvider: models.selectCredentialProvider,
    setSetup: models.setSetup,
    saveApiKey: models.saveApiKey
  };
}

export type AiSettingsModel = ReturnType<typeof useAiSettings>;

function unsupported(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'unsupported'
  );
}

function configurationData(
  status: AiConfiguration['status'] | undefined,
  providers: AiConfiguration['providers'] | undefined,
  settings: AiConfiguration['settings'] | undefined
): AiConfiguration | undefined {
  return status && providers && settings ? { status, providers, settings } : undefined;
}
