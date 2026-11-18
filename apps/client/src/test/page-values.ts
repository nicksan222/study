import {
  defaultAppearancePreferences,
  defaultWorkspacePreferences,
  noteIdSchema
} from '@study/contracts';
import type { RpcFixtureValues } from '@study/contracts/react/testing';
import { Option } from 'effect';

import type { Locale } from '../lib/i18n';

/** Empty, bounded product snapshots for route presentation tests. Individual journeys supply their own fixtures. */
export function pageTestValues(locale: Locale = 'english'): RpcFixtureValues {
  const snapshots: RpcFixtureValues = {
    'system.health': { protocolVersion: 1, workersRunning: true, testMode: false },

    'settings.modelUpdates': [],
    'settings.modelCatalog': { models: {}, recommendations: [] },
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
    'notes.count': 0n,
    'pages.count': 0n,
    'materials.count': 0n,
    'projects.findProject': Option.none(),
    'projects.projects': { items: [], next: null },
    'notes.notes': { items: [], next: null },
    'notes.assistantChats': { items: [], next: null },
    'workflows.executions': { items: [], next: null },
    'workflows.agentProgress': [],
    'notes.thread': { items: [], next: null },
    'pages.pages': { items: [], nextCursor: null },
    'sources.sources': { items: [], next: null },
    'materials.activeMaterialGenerations': [],
    'materials.materials': { items: [], nextCursor: null },
    'themes.themes': { items: [], next: null },

    'themes.selectedTheme': null,

    'auth.status': { signedIn: false, email: null, sharing: false },

    'auth.providers': [],

    'settings.llmSettings': {
      tiny: { provider: 1, model: 1 },
      medium: { provider: 1, model: 2 },
      smart: { provider: 1, model: 3 }
    },

    'notes.assistantNote': {
      id: noteIdSchema.make(91n),
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

  return snapshots;
}
