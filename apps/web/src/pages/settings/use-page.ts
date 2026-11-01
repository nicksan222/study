import type { AppearancePreferences } from '@study/contracts/settings/types';
import type { Appearance as AppearanceMode } from '@study/ui/theme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { applyAppearance } from '../../lib/appearance';
import { appearanceQueryOptions, appearanceMutationOptions } from './appearance.queries';
import type { AppearanceData } from './appearance.queries';
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

export function useAppearance(): AppearanceModel {
  const client = useQueryClient();
  const query = useQuery(appearanceQueryOptions());

  useEffect(() => {
    if (query.data) applyAppearance(query.data);
  }, [query.data]);
  const mutation = useMutation({
    ...appearanceMutationOptions(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: appearanceQueryOptions().queryKey });
    }
  });

  return {
    data: query.data,
    loading: query.isPending,
    error: query.isError || mutation.isError,
    pending: mutation.isPending,
    retry: () => {
      mutation.reset();
      void query.refetch();
    },
    setPreferences: (preferences) => mutation.mutate({ type: 'preferences', preferences }),
    setZoom: (percent) => mutation.mutate({ type: 'zoom', percent }),
    setAppearance: (mode) => mutation.mutate({ type: 'appearance', mode }),
    selectTheme: (id) => mutation.mutate({ type: 'select', id }),
    importTheme: (json) => mutation.mutateAsync({ type: 'import', json }),
    saveTheme: (json) => mutation.mutateAsync({ type: 'save', json }),
    deleteTheme: (id) => mutation.mutateAsync({ type: 'delete', id })
  };
}

export function usePage(onClose?: () => void) {
  const navigate = useNavigate();
  const model = useAppearance();
  const [search, onSearch] = useState('');
  const [section, setSection] = useState<SettingsSectionId>('appearance');

  return {
    search,
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
