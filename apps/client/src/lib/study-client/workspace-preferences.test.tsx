import { workspacePreferencesSchema, defaultWorkspacePreferences } from '@study/contracts';
import type { WorkspacePreferences } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import {
  useWorkspacePreferences,
  useWorkspacePreferenceControls
} from './workspace-preferences.queries';

function createApi(mock: test.Mock) {
  return {
    read: mock.fn<() => Promise<WorkspacePreferences>>(),
    save: mock.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>()
  };
}

let api: ReturnType<typeof createApi>;

test.unit.beforeEach(({ mock }) => {
  api = createApi(mock);
});

function wrapper({ rpcTestTransport }: Pick<test.unit.Context, 'rpcTestTransport'>) {
  let saved: WorkspacePreferences | undefined;

  return rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.workspacePreferences') return saved ?? api.read();

    if (tag === 'settings.saveWorkspacePreferences') {
      const preferences = Schema.decodeUnknownSync(workspacePreferencesSchema)(input);

      saved = preferences;
      await api.save(preferences);

      return {};
    }

    throw new Error(`Unexpected ${tag}`);
  }).wrapper;
}

test.unit.stable(
  'uses canonical defaults when preferences cannot be loaded',
  async ({ renderHook, waitFor, expect, rpcTestTransport }) => {
    api.read.mockRejectedValue(new Error('Disconnected'));
    const view = renderHook(() => useWorkspacePreferences(), {
      wrapper: wrapper({ rpcTestTransport })
    });

    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(view.result.current).toEqual(defaultWorkspacePreferences);
  }
);

test.unit.stable(
  'reads fresh preferences before a partial save and preserves another window’s changes',
  async ({ renderHook, waitFor, expect, act, rpcTestTransport }) => {
    const fresh = {
      ...defaultWorkspacePreferences,
      readerFontSize: 22,
      sidebarDensity: 'compact' as const
    };

    api.read.mockResolvedValueOnce(defaultWorkspacePreferences).mockResolvedValue(fresh);
    api.save.mockImplementation(async (value) => {
      api.read.mockResolvedValue(value);

      return value;
    });
    const view = renderHook(() => useWorkspacePreferenceControls(), {
      wrapper: wrapper({ rpcTestTransport })
    });

    await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
    await act(async () => {
      await view.result.current.mutation.mutateAsync({ spellcheck: false });
    });
    expect(api.save).toHaveBeenCalledWith({ ...fresh, spellcheck: false });
    await waitFor(() =>
      expect(view.result.current.query.data).toEqual({ ...fresh, spellcheck: false })
    );
  }
);
