import { defaultAppearancePreferences, defaultWorkspacePreferences } from '@study/contracts';
import { configureRpcTransport } from '@study/contracts/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';

import { Providers } from '../app/providers';
import { createAppRouter } from '../app/router';
import type { Locale } from '../lib/i18n';
import { rpcTestTransport } from './rpc';

/** Empty, bounded product snapshots for route presentation tests. Individual journeys supply their own fixtures. */
export function pageTestTransport(
  locale: Locale = 'english',
  overrides: Record<string, unknown> = {}
) {
  const snapshots: Record<string, unknown> = {
    'system.health': { protocolVersion: 1, workersRunning: true, testMode: false },

    'settings.appSettings': {
      language: locale === 'italian' ? 2 : 1,
      appearance: 3,
      zoomPercent: 100,
      onboarded: true
    },

    'settings.workspacePreferences': defaultWorkspacePreferences,

    'settings.appearancePreferences': defaultAppearancePreferences,

    'settings.sidebarSettings': { settledPageThreshold: 1 },

    'notes.noteSummaries': { items: [] },

    'themes.selectedTheme': null,

    'auth.status': { signedIn: false, email: null, sharing: false },

    'auth.providers': [],

    'settings.llmSettings': {
      tiny: { provider: 1, model: 1 },
      medium: { provider: 1, model: 2 },
      smart: { provider: 1, model: 3 }
    },

    'notes.assistantNote': {
      id: 91n,
      projectIds: [],
      title: 'Assistant',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    },

    'notes.assistantContext': {
      estimatedTokens: 0,
      maxTokens: 50000,
      autoCompact: true,
      lastCompactedAtMs: null
    }
  };

  const values = { ...snapshots, ...overrides };

  return rpcTestTransport(async (tag) =>
    Object.hasOwn(values, tag) ? values[tag] : { items: [], next: null, nextCursor: null }
  );
}

export function renderPage(
  path: string,
  locale: Locale = 'english',
  fixture = pageTestTransport(locale)
) {
  configureRpcTransport(fixture.transport);
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));

  return {
    ...render(
      <Providers locale={locale} transport={fixture.transport}>
        <RouterProvider router={router} />
      </Providers>
    ),
    router,
    notify: fixture.notify
  };
}
