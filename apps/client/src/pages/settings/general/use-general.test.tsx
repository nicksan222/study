import type { AppSettings } from '@study/contracts';
import { test } from '@study/testing';

import { useI18n } from '#client/lib/i18n.tsx';

import { useGeneralSettings } from './use-general';

test.stable.extend('locale', 'italian')(
  'updates language only after a confirmed save and preserves other settings',
  async ({ react, rpc }) => {
    const settings: AppSettings = { language: 2, appearance: 3, zoomPercent: 125, onboarded: true };
    const save = test.vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});

    rpc.given({ 'settings.appSettings': settings });
    rpc.handle({ 'settings.saveAppSettings': (input) => save(input) });
    const { result } = react.renderHook(() => ({
      model: useGeneralSettings(),
      localization: useI18n()
    }));

    await react.waitFor(() => test.expect(result.current.model.data).toEqual(settings));
    react.act(() => result.current.model.setLanguage('english'));
    await react.waitFor(() => test.expect(result.current.model.error).toBe(true));
    test.expect(result.current.localization.locale).toBe('italian');
    react.act(() => result.current.model.setLanguage('english'));
    await react.waitFor(() => test.expect(result.current.localization.locale).toBe('english'));
    test.expect(save).toHaveBeenLastCalledWith({ ...settings, language: 1 });
  }
);
