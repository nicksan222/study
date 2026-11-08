import { StudyError } from '@study/contracts/errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { prepareSignInBrowser } from '#web/lib/sign-in-browser.ts';
import type { SignInBrowser } from '#web/lib/sign-in-browser.ts';

import {
  aiSettingsQueryOptions,
  startSignInOptions,
  finishSignInOptions,
  cancelSignInOptions,
  signOutOptions,
  disposeSignIn
} from './ai.queries';
import type { SignInAttempt } from './ai.queries';
import { useProviderSettings } from './use-provider-settings';

function requestState(results: readonly { isPending: boolean; isError: boolean }[]) {
  return {
    pending: results.some((result) => result.isPending),
    error: results.some((result) => result.isError)
  };
}

function isUnsupportedSignIn(error: unknown) {
  return error instanceof StudyError && error.kind === 'unsupported';
}

async function openAttemptBrowser(browser: SignInBrowser | undefined, attempt: SignInAttempt) {
  try {
    return (await browser?.open(attempt.url)) ?? false;
  } catch (error) {
    await disposeSignIn(attempt.attemptId).catch(() => {});

    throw error;
  }
}

/** Keep settings refresh ownership shared by sign-in and provider configuration. */
function useSettingsQuery() {
  const client = useQueryClient();
  const query = useQuery(aiSettingsQueryOptions());

  return {
    query,
    refresh: () => client.invalidateQueries({ queryKey: aiSettingsQueryOptions().queryKey })
  };
}

export function useAiSettings() {
  const { query, refresh } = useSettingsQuery();
  const [attempt, setAttempt] = useState<SignInAttempt>();
  const [popupBlocked, setPopupBlocked] = useState(false);
  const browser = useRef<SignInBrowser | undefined>(undefined);
  const closeBrowser = () => {
    browser.current?.close();
    browser.current = undefined;
  };
  const owned = useRef<SignInAttempt | undefined>(undefined);
  const mounted = useRef(true);
  const finishing = useRef<AbortController | undefined>(undefined);
  const start = useMutation({
    ...startSignInOptions(),
    onSuccess: async (value) => {
      if (!mounted.current) {
        void disposeSignIn(value.attemptId).catch(() => {});

        return;
      }

      owned.current = value;
      const opened = await openAttemptBrowser(browser.current, value);

      if (!mounted.current || owned.current !== value) return;

      setAttempt(value);
      setPopupBlocked(!opened);
      finishing.current = new AbortController();
      finish.mutate({ attemptId: value.attemptId, signal: finishing.current.signal });
    },
    onError: () => {
      owned.current = undefined;
      closeBrowser();
    }
  });
  const finish = useMutation({
    ...finishSignInOptions(),
    onSuccess: (_result, input) => {
      if (owned.current?.attemptId !== input.attemptId) return;

      owned.current = undefined;
      setAttempt(undefined);
      closeBrowser();

      return refresh();
    },
    onError: (_error, input) => {
      if (owned.current?.attemptId !== input.attemptId) return;

      owned.current = undefined;
      setAttempt(undefined);
      closeBrowser();
    }
  });
  const cancel = useMutation({
    ...cancelSignInOptions(),
    onSuccess: () => {
      finishing.current?.abort();
      closeBrowser();
      owned.current = undefined;
      setAttempt(undefined);
      finish.reset();
      start.reset();

      return refresh();
    }
  });
  const signOut = useMutation({ ...signOutOptions(), onSuccess: refresh });
  const models = useProviderSettings(query.data, refresh);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      finishing.current?.abort();
      closeBrowser();

      if (owned.current) void disposeSignIn(owned.current.attemptId).catch(() => {});
    };
  }, []);

  return {
    data: query.data,
    signInUnsupported: isUnsupportedSignIn(start.error),
    loading: query.isPending,
    ...requestState([
      { isPending: false, isError: query.isError || models.error },
      start,
      { isPending: finish.isPending, isError: finish.isError && !cancel.isPending },
      cancel,
      signOut,
      { isPending: models.pending, isError: false }
    ]),
    cancelling: cancel.isPending,
    attempt,
    popupBlocked,
    retry: () => {
      start.reset();
      finish.reset();
      cancel.reset();
      signOut.reset();
      models.retry();
      void query.refetch();
    },
    start: () => {
      finish.reset();
      cancel.reset();
      browser.current = prepareSignInBrowser();
      setPopupBlocked(false);
      start.mutate();
    },
    cancel: () => {
      if (attempt) cancel.mutate(attempt.attemptId);
    },
    signOut: () => signOut.mutate(),
    credentialProvider: models.credentialProvider,
    selectCredentialProvider: models.selectCredentialProvider,
    setSetup: models.setSetup,
    saveApiKey: models.saveApiKey
  };
}

export type AiSettingsModel = ReturnType<typeof useAiSettings>;
