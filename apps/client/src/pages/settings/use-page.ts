import { Appearance } from '@study/contracts';
import type { ProjectId, AppearancePreferences } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import type { Appearance as AppearanceMode } from '@study/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useContext, useEffect, useMemo, useState } from 'react';

import { applyAppearance } from '#client/lib/appearance.ts';
import { ClientModules } from '#client/lib/client-modules.ts';

import type { AppearanceData } from './appearance.queries';
import { useAppSettingsPatch } from './general/app-settings';
import type { SettingsSectionId } from './page.view';

export interface AppearanceModel {
  data?: AppearanceData;
  loading: boolean;
  error: boolean;
  pending: boolean;
  retry: () => void;
  setPreferences: (preferences: AppearancePreferences) => void;
  setZoom: (percent: number) => void;
  setAppearance: (mode: AppearanceMode) => void;
  selectTheme: (id: string) => void;
  importTheme: (json: string) => Promise<unknown>;
  saveTheme: (json: string) => Promise<unknown>;
  deleteTheme: (id: string) => Promise<unknown>;
}

/** Loads persisted appearance data and refreshes it after preference or theme mutations. */
export function useAppearance(): AppearanceModel {
  const settings = rpc.settings.appSettings.useQuery({});
  const selected = rpc.themes.selectedTheme.useQuery({});
  const themes = rpc.themes.list.useQuery({ limit: 100 });
  const preferences = rpc.settings.appearancePreferences.useQuery({});
  const data = useMemo(
    () =>
      settings.data && selected.isSuccess && themes.data && preferences.data
        ? {
            settings: settings.data,
            selected: selected.data ?? null,
            themes: [...themes.data.items],
            preferences: preferences.data
          }
        : undefined,
    [settings.data, selected.isSuccess, selected.data, themes.data, preferences.data]
  );
  const saveSettings = useAppSettingsPatch();
  const savePreferences = rpc.settings.saveAppearancePreferences.useMutation();
  const select = rpc.themes.select.useMutation();
  const importTheme = rpc.themes.importTheme.useMutation();
  const saveTheme = rpc.themes.save.useMutation();
  const deleteTheme = rpc.themes.delete.useMutation();
  const queries = [settings, selected, themes, preferences];
  const mutations = [saveSettings, savePreferences, select, importTheme, saveTheme, deleteTheme];

  useEffect(() => {
    if (data) applyAppearance(data);
  }, [data]);

  return {
    data,
    loading: queries.some((query) => query.isPending),
    error:
      queries.some((query) => query.isError || query.stale) ||
      mutations.some((mutation) => mutation.isError),
    pending: mutations.some((mutation) => mutation.isPending),
    retry: () => {
      queries.forEach((query) => query.refetch());
      mutations.forEach((mutation) => mutation.reset());
    },
    setPreferences: (value) => {
      void savePreferences.mutateAsync(value).catch(() => {});
    },
    setZoom: (zoomPercent) => {
      if (settings.data) void saveSettings.mutateAsync({ zoomPercent }).catch(() => {});
    },
    setAppearance: (mode) => {
      if (settings.data)
        void saveSettings
          .mutateAsync({
            appearance:
              mode === 'system'
                ? Appearance.SYSTEM
                : mode === 'light'
                  ? Appearance.LIGHT
                  : Appearance.DARK
          })
          .catch(() => {});
    },
    selectTheme: (id) => {
      void select.mutateAsync({ id }).catch(() => {});
    },
    importTheme: (json) => importTheme.mutateAsync({ json }),
    saveTheme: (json) => saveTheme.mutateAsync({ json }),
    deleteTheme: (id) => deleteTheme.mutateAsync({ id })
  };
}

/** Keeps section navigation local and clears search when opening a different settings section. */
export function usePage(
  onClose?: () => void,
  initialSection: SettingsSectionId = 'appearance',
  workspaceProject?: ProjectId
) {
  const navigate = useNavigate();
  const scope = useSearch({ from: '__root__' });
  const model = useAppearance();
  const modules = useContext(ClientModules);
  const [search, onSearch] = useState('');
  const [section, setSection] = useState<SettingsSectionId>(initialSection);

  return {
    onProjectDeleted: (id: ProjectId) => {
      const activeProject =
        workspaceProject === undefined ? scope.project : String(workspaceProject);

      if (activeProject === String(id)) {
        void navigate({ to: '/notes', search: {}, replace: true });
      } else if (scope.project === String(id)) {
        void navigate({
          to: '.',
          search: (previous) => ({ ...previous, project: undefined }),
          replace: true
        });
      }
    },
    search,
    extra: modules.flatMap(({ settings }) => (settings ? [settings] : [])),
    onSearch,
    section,
    onSectionChange: (next: SettingsSectionId) => {
      onSearch('');
      setSection(next);
    },
    model,
    onClose:
      onClose ??
      (() => {
        void navigate({ to: '/home' });
      })
  };
}
