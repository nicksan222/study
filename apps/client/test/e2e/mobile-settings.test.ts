import { Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.browser.use({ desktop: true, video: 'on' });

test.browser.stable(
  'Phone settings explain pairing on desktop and phone widths',
  async ({ page, rpc, expectScreenshot, expectAccessibility, expect }) => {
    const { english, italian } = catalogs;

    await page.goto('/notes');
    await page.getByRole('button', { name: english.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: english.Settings });
    const entry = dialog.getByRole('navigation').getByRole('button', { name: english.MobileStudy });

    await expect(entry).toBeVisible();
    await entry.press('Enter');
    await expect(entry).toHaveAttribute('aria-current', 'page');
    const steps = dialog.getByRole('list').filter({ hasText: english.MobileScanTitle });

    await expect(steps.getByRole('listitem')).toHaveCount(3);
    await expect(steps.getByRole('listitem')).toContainText([
      english.MobileScanTitle,
      english.MobileMatchTitle,
      english.MobileAvailabilityTitle
    ]);
    const scan = dialog.locator('.mobile-study-scan');
    const pulse = dialog.locator('.mobile-study-pulse');

    await expect(scan).toHaveCSS('animation-name', 'none');
    await expect(pulse).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(scan).toHaveCSS('animation-name', 'mobile-study-scan');
    await expect(pulse).toHaveCSS('animation-name', 'mobile-study-connect');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expectScreenshot('guide', {
      target: dialog,
      ready: () => expect(dialog.getByRole('button', { name: english.MobilePair })).toBeEnabled()
    });
    await expectAccessibility('pairing-guide');
    await dialog.getByRole('button', { name: english.Close, exact: true }).click();

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: italian.ToggleSidebar, exact: true }).click();
    await page.getByRole('button', { name: italian.Settings, exact: true }).click();
    const localized = page.getByRole('dialog', { name: italian.Settings });

    await localized
      .getByRole('navigation')
      .getByRole('button', { name: italian.MobileStudy })
      .click();
    await expect(localized.getByText(italian.MobileMatchDescription)).toBeVisible();
    await expect(localized.getByText(italian.MobileAvailabilityDescription)).toBeVisible();
    await expectScreenshot('guide-italian-narrow', {
      target: 'viewport',
      ready: () => expect(localized.getByRole('button', { name: italian.MobilePair })).toBeEnabled()
    });
    await expectAccessibility('pairing-guide-italian');
  }
);
