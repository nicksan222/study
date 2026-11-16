import { StudyError } from '@study/contracts';
import type { AppSettings } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { useI18n } from '#client/lib/i18n.tsx';
import { useGeneralSettings } from '#client/pages/settings/general/use-general.ts';
test.stable.extend('locale', 'italian')(
  'React starters provide RPC, localization, hook rendering and planned failure recovery',
  async ({ react, rpc }) => {
    const settings: AppSettings = { language: 2, appearance: 3, zoomPercent: 125, onboarded: true };

    rpc.given({ 'settings.appSettings': settings });
    let fail = true;

    rpc.handle({
      'settings.saveAppSettings': (input) => {
        if (fail) {
          fail = false;

          throw new StudyError('transient', 'Offline');
        }

        rpc.given({ 'settings.appSettings': input });

        return {};
      }
    });
    const view = react.renderHook(() => ({
      model: useGeneralSettings(),
      locale: useI18n().locale
    }));

    await react.waitFor(() => test.expect(view.result.current.model.data).toEqual(settings));
    react.act(() => view.result.current.model.setLanguage('english'));
    await react.waitFor(() => test.expect(view.result.current.model.error).toBe(true));
    test.expect(view.result.current.locale).toBe('italian');
    react.act(() => view.result.current.model.setLanguage('english'));
    await react.waitFor(() => test.expect(view.result.current.locale).toBe('english'));
    test.expect(view.result.current.model.data?.zoomPercent).toBe(125);
  }
);

test.stable(
  'React starters restore the default locale and have no prior subscriptions',
  ({ react, rpc }) => {
    test.expect(rpc.activeSubscriptions()).toBe(0);
    const view = react.renderHook(
      ({ value }: { value: number }) => ({ locale: useI18n().locale, value }),
      { initialProps: { value: 1 } }
    );

    view.rerender({ value: 2 });
    test.expect(view.result.current.value).toBe(2);
    test.expect(view.result.current.locale).toBe('english');
    test.expect(react.screen.queryByRole('button')).not.toBeInTheDocument();
  }
);

test.stable(
  'page starters open the real route with default RPC snapshots and accept live updates',
  async ({ page, rpc }) => {
    const view = page.open('/notes');

    test
      .expect(await page.screen.findByRole('heading', { name: catalogs.english.Notes }))
      .toBeVisible();
    test.expect(view.router.state.location.pathname).toBe('/notes');
    await rpc.update({
      'settings.appSettings': {
        language: 2,
        appearance: 3,
        zoomPercent: 100,
        onboarded: true
      }
    });
    test
      .expect(await page.screen.findByRole('heading', { name: catalogs.italian.Notes }))
      .toBeVisible();
  }
);

test.stable(
  'closing a page releases its router history and RPC subscriptions',
  async ({ page, rpc }) => {
    const view = page.open('/notes');

    await page.screen.findByRole('heading', { name: catalogs.english.Notes });
    const destroy = test.vi.spyOn(view.router.history, 'destroy');

    await page.close();
    test.expect(destroy).toHaveBeenCalledOnce();
    test.expect(rpc.activeSubscriptions()).toBe(0);
  }
);
