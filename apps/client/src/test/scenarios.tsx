import { configureRpcTransport } from '@study/contracts/react';
import type { RpcFixtureValues } from '@study/contracts/react/testing';
import {
  rpcTestTransport,
  rpcHandlersTransport,
  rpcValuesTransport,
  createRpcScenario
} from '@study/contracts/react/testing';
import { createReactHarness } from '@study/testing/react';
import { test as baseTest, createTestApi } from '@study/testing/vitest';
import { TooltipProvider, ToastProvider } from '@study/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  RouterContextProvider
} from '@tanstack/react-router';
import {
  act,
  waitFor,
  render,
  renderHook,
  screen,
  cleanup,
  fireEvent,
  within,
  createEvent
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { LanguageProvider, useI18n } from '#client/lib/i18n.tsx';
import type { Locale } from '#client/lib/i18n.tsx';

import { pageTestValues } from './page-values';
import { renderInRouter } from './render-in-router';

function ScenarioToasts({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <ToastProvider closeLabel={t('Close')} viewportLabel={t('NotificationsLabel')}>
      {children}
    </ToastProvider>
  );
}

const testScenario = baseTest.stable
  .extend('locale', 'english' as Locale)
  .extend('rpc', ({ task: _task }, { onCleanup }) => {
    const rpc = createRpcScenario();
    const release = configureRpcTransport(rpc.transport);

    onCleanup(() => {
      try {
        rpc.verify();
      } finally {
        release();
      }
    });

    return {
      ...rpc,
      givenWorkspace(locale: Locale = 'english') {
        rpc.given(pageTestValues(locale));
      },
      async update(values: Parameters<typeof rpc.update>[0]) {
        await act(async () => {
          await rpc.update(values);
        });
      }
    };
  });

function ownView(
  view: ReturnType<typeof createReactHarness>,
  rpc: ReturnType<typeof createRpcScenario>,
  previousLanguage: string
) {
  return async () => {
    try {
      view.close();
      await waitFor(() => {
        if (rpc.activeSubscriptions()) throw new Error('RPC subscriptions did not close');
      });
    } finally {
      document.documentElement.lang = previousLanguage;
    }
  };
}

/** Components and hooks receive a memory router, localization, UI providers and controlled RPC. */
const withReact = testScenario.extend('react', async ({ rpc, locale }, { onCleanup }) => {
  const previousLanguage = document.documentElement.lang;
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  await router.load();
  const view = createReactHarness(({ children }) => (
    <rpc.wrapper>
      <LanguageProvider locale={locale}>
        <TooltipProvider>
          <ScenarioToasts>
            <RouterContextProvider router={router}>{children}</RouterContextProvider>
          </ScenarioToasts>
        </TooltipProvider>
      </LanguageProvider>
    </rpc.wrapper>
  ));

  onCleanup(async () => {
    try {
      await ownView(view, rpc, previousLanguage)();
    } finally {
      router.history.destroy();
    }
  });

  return view;
});

/** Full application routes receive production providers and a bounded explicit set of empty snapshots. */
const withPage = withReact.extend('page', async ({ rpc, locale }, { onCleanup }) => {
  rpc.givenWorkspace(locale);
  const [{ Providers }, { createAppRouter }] = await Promise.all([
    import('#client/app/providers.tsx'),
    import('#client/app/router.ts')
  ]);

  const release = configureRpcTransport(rpc.transport);
  const cleanup = new AsyncDisposableStack();

  onCleanup(() => cleanup.disposeAsync());
  cleanup.defer(release);
  const histories = new DisposableStack();

  cleanup.defer(() => histories.dispose());
  const previousLanguage = document.documentElement.lang;
  let selectedLocale = locale;
  const view = createReactHarness(({ children }) => (
    <Providers locale={selectedLocale} transport={rpc.transport}>
      {children}
    </Providers>
  ));

  cleanup.defer(ownView(view, rpc, previousLanguage));

  return {
    user: view.user,
    screen: view.screen,
    close: () => cleanup.disposeAsync(),
    open(path: string, options: { locale?: Locale; values?: RpcFixtureValues } = {}) {
      selectedLocale = options.locale ?? locale;

      if (options.locale)
        rpc.given({
          'settings.appSettings': pageTestValues(selectedLocale)['settings.appSettings']
        });

      if (options.values) rpc.given(options.values);

      const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));

      histories.defer(() => router.history.destroy());

      return { ...view.render(<RouterProvider router={router} />), router, notify: rpc.notify };
    }
  };
});

/** One classified registration API; requested native fixtures own their complete lifecycle. */
type ClientTestApi = Omit<ReturnType<typeof createTestApi<typeof withPage>>, 'waitFor'> & {
  readonly renderInRouter: typeof renderInRouter;
  readonly act: typeof act;
  readonly waitFor: typeof waitFor;
  readonly render: typeof render;
  readonly renderHook: typeof renderHook;
  readonly screen: typeof screen;
  readonly cleanup: typeof cleanup;
  readonly fireEvent: typeof fireEvent;
  readonly within: typeof within;
  readonly createEvent: typeof createEvent;
  readonly userEvent: typeof userEvent;
  readonly rpcTestTransport: typeof rpcTestTransport;
  readonly rpcHandlersTransport: typeof rpcHandlersTransport;
  readonly rpcValuesTransport: typeof rpcValuesTransport;
  readonly createRpcScenario: typeof createRpcScenario;
};

export const test: ClientTestApi = {
  ...createTestApi(withPage),
  renderInRouter,
  act,
  waitFor,
  render,
  renderHook,
  screen,
  cleanup,
  fireEvent,
  within,
  createEvent,
  userEvent,
  rpcTestTransport,
  rpcHandlersTransport,
  rpcValuesTransport,
  createRpcScenario
};
