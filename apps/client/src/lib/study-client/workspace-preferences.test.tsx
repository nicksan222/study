import { workspacePreferencesSchema, defaultWorkspacePreferences } from '@study/contracts';
import type { WorkspacePreferences } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import {
  useWorkspacePreferences,
  useWorkspacePreferenceControls
} from './workspace-preferences.queries';

let api: {
  read: ReturnType<typeof test.vi.fn<() => Promise<WorkspacePreferences>>>;
  save: ReturnType<
    typeof test.vi.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>
  >;
};

test.beforeEach(({ mock }) => {
  api = {
    read: mock.fn<() => Promise<WorkspacePreferences>>(),
    save: mock.fn<(value: WorkspacePreferences) => Promise<WorkspacePreferences>>()
  };
});

function wrapper() {
  let saved: WorkspacePreferences | undefined;

  return test.rpcTestTransport(async (tag, input) => {
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

test.stable('uses canonical defaults when preferences cannot be loaded', async () => {
  api.read.mockRejectedValue(new Error('Disconnected'));
  const view = test.renderHook(() => useWorkspacePreferences(), { wrapper: wrapper() });

  await test.waitFor(() => test.expect(api.read).toHaveBeenCalled());
  test.expect(view.result.current).toEqual(defaultWorkspacePreferences);
});

test.stable(
  'reads fresh preferences before a partial save and preserves another window’s changes',
  async () => {
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
    const view = test.renderHook(() => useWorkspacePreferenceControls(), { wrapper: wrapper() });

    await test.waitFor(() => test.expect(view.result.current.query.isSuccess).toBe(true));
    await test.act(async () => {
      await view.result.current.mutation.mutateAsync({ spellcheck: false });
    });
    test.expect(api.save).toHaveBeenCalledWith({ ...fresh, spellcheck: false });
    await test.waitFor(() =>
      test.expect(view.result.current.query.data).toEqual({ ...fresh, spellcheck: false })
    );
  }
);
