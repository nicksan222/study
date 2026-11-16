import { configureRpcTransport } from '@study/contracts/react';
import type { RpcFixtureValues } from '@study/contracts/react/testing';
import {
  rpcTestTransport,
  rpcHandlersTransport,
  rpcValuesTransport,
  createRpcScenario
} from '@study/contracts/react/testing';
import { createReactHarness } from '@study/testing/react';
import { test as baseTest, createTestApi, createMockScope } from '@study/testing/vitest';
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
import { createRenderInRouter } from './render-in-router';

const clientSourceRoot = Bun.fileURLToPath(URL.parse('../', import.meta.url)!);

function ScenarioToasts({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <ToastProvider closeLabel={t('Close')} viewportLabel={t('NotificationsLabel')}>
      {children}
    </ToastProvider>
  );
}

const testScenario = baseTest.unit.stable
  .override('mock', ({ task: _task }, { onCleanup }) => {
    const mock = createMockScope({
      resolve: (source) =>
        source.startsWith('#client/') ? clientSourceRoot + source.slice(8) : source
    });

    onCleanup(() => mock.close());

    return mock;
  })
  .override(
    'waitFor',
    () =>
      <T,>(callback: () => T | Promise<T>, options?: Parameters<typeof waitFor>[1] | number) =>
        waitFor(callback, typeof options === 'number' ? { timeout: options } : options)
  )
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
const withReact = testScenario.extend(
  'react',
  async ({ rpc, locale, mock: _mock }, { onCleanup }) => {
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
  }
);

/** Full application routes receive production providers and a bounded explicit set of empty snapshots. */
const withPage = withReact.extend('page', ({ rpc, locale, mock: _mock }, { onCleanup }) => {
  rpc.givenWorkspace(locale);
  const cleanup = new AsyncDisposableStack();
  const histories = new DisposableStack();
  const previousLanguage = document.documentElement.lang;
  let selectedLocale = locale;
  let closed = false;
  let release = () => {};
  let application: Awaited<ReturnType<typeof load>> | undefined;
  let loading: ReturnType<typeof load> | undefined;

  async function load() {
    const [{ Providers }, { createAppRouter }] = await Promise.all([
      import('#client/app/providers.tsx'),
      import('#client/app/router.ts')
    ]);

    release = configureRpcTransport(rpc.transport);

    return { Providers, createAppRouter };
  }

  cleanup.defer(async () => {
    try {
      await loading;
    } finally {
      release();
    }
  });
  cleanup.defer(() => histories.dispose());

  const view = createReactHarness(({ children }) => {
    if (!application) throw new ReferenceError('Open the page before rendering its providers');

    const { Providers } = application;

    return (
      <Providers locale={selectedLocale} transport={rpc.transport}>
        {children}
      </Providers>
    );
  });

  cleanup.defer(ownView(view, rpc, previousLanguage));

  const close = () => {
    closed = true;

    return cleanup.disposeAsync();
  };

  onCleanup(close);

  return {
    user: view.user,
    screen: view.screen,
    close,
    async open(path: string, options: { locale?: Locale; values?: RpcFixtureValues } = {}) {
      if (closed) throw new ReferenceError('Page scenario is closed');

      application = await (loading ??= load());

      if (closed) throw new ReferenceError('Page scenario is closed');

      selectedLocale = options.locale ?? locale;

      if (options.locale)
        rpc.given({
          'settings.appSettings': pageTestValues(selectedLocale)['settings.appSettings']
        });

      if (options.values) rpc.given(options.values);

      const router = application.createAppRouter(createMemoryHistory({ initialEntries: [path] }));

      histories.defer(() => router.history.destroy());

      return { ...view.render(<RouterProvider router={router} />), router, notify: rpc.notify };
    }
  };
});

/** One classified registration API; requested native fixtures own their complete lifecycle. */
const withAssistant = withPage.extend('assistant', async ({ mock }, { onCleanup }) => {
  const { createAssistantHarness } = await import('./assistant.tsx');
  const assistant = createAssistantHarness(mock);

  onCleanup(() => assistant.close());

  return assistant;
});

const withClientTools = withAssistant
  .extend('renderInRouter', ({ task: _task }, { onCleanup }) =>
    createRenderInRouter((cleanup) => onCleanup(cleanup))
  )
  .extend('act', () => act)
  .extend('render', () => render)
  .extend('renderHook', () => renderHook)
  .extend('screen', () => screen)
  .extend('cleanup', () => cleanup)
  .extend('fireEvent', () => fireEvent)
  .extend('within', () => within)
  .extend('createEvent', () => createEvent)
  .extend('userEvent', () => userEvent)
  .extend('rpcTestTransport', () => rpcTestTransport)
  .extend('rpcHandlersTransport', () => rpcHandlersTransport)
  .extend('rpcValuesTransport', () => rpcValuesTransport)
  .extend('createRpcScenario', () => createRpcScenario);

export const test = { unit: createTestApi(withClientTools) };
