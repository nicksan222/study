import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { LanguageProvider, useI18n } from '#client/lib/i18n.tsx';
import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { useGeneralSettings } from './use-general';

testStable(
  'updates language only after a confirmed save and preserves other settings',
  async () => {
    const settings = { language: 2, appearance: 3, zoomPercent: 125, onboarded: true };
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const fixture = settingsTransport(async (tag, input) =>
      tag === 'settings.appSettings' ? settings : save(input)
    );
    const { result } = renderHook(
      () => ({ model: useGeneralSettings(), localization: useI18n() }),
      {
        wrapper: ({ children }) => (
          <LanguageProvider locale="italian">
            <fixture.wrapper>{children}</fixture.wrapper>
          </LanguageProvider>
        )
      }
    );

    await waitFor(() => expect(result.current.model.data).toEqual(settings));
    act(() => result.current.model.setLanguage('english'));
    await waitFor(() => expect(result.current.model.error).toBe(true));
    expect(result.current.localization.locale).toBe('italian');
    act(() => result.current.model.setLanguage('english'));
    await waitFor(() => expect(result.current.localization.locale).toBe('english'));
    expect(save).toHaveBeenLastCalledWith({ ...settings, language: 1 });
  }
);
