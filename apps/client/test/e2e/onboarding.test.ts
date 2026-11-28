import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const { english, italian } = catalogs;

test.browser.use({ firstRun: true });

test.browser.stable(
  'First-run setup saves language and appearance without signing in',
  async ({ page, expect, expectScreenshot }) => {
    const root = page.locator('html');
    const start = page.getByRole('dialog', { name: english.OnboardingWelcomeTitle, exact: true });

    await page.goto('/notes');
    await start.getByRole('button', { name: english.OnboardingStart, exact: true }).click();
    const language = page.getByRole('dialog', {
      name: english.GeneralSettingsLanguage,
      exact: true
    });

    await language.getByRole('combobox', { name: english.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: english.ItalianOwnName, exact: true }).click();
    await page
      .getByRole('dialog', { name: italian.GeneralSettingsLanguage, exact: true })
      .getByRole('button', { name: italian.OnboardingNext, exact: true })
      .click();
    const appearance = page.getByRole('dialog', { name: italian.ColorScheme, exact: true });
    const light = appearance.getByRole('radio', { name: italian.Light, exact: true });

    await expect(appearance.getByRole('radio', { name: italian.Dark, exact: true })).toBeChecked();
    await light.click();
    await expect(light).toBeChecked();
    await expect(root).toHaveCSS('color-scheme', 'light');

    for (const name of [
      italian.ColorScheme,
      italian.OnboardingSubjectsTitle,
      italian.OnboardingNotesTitle,
      italian.OnboardingPagesTitle,
      italian.OnboardingWorkflowTitle
    ]) {
      await page
        .getByRole('dialog', { name, exact: true })
        .getByRole('button', { name: italian.OnboardingNext, exact: true })
        .click();
    }

    const account = page.getByRole('dialog', { name: italian.OnboardingConnectTitle, exact: true });
    const signIn = account.getByRole('button', { name: italian.AiSettingsSignIn, exact: true });
    const finish = account.getByRole('button', { name: italian.OnboardingFinish, exact: true });

    await expect(signIn).toBeEnabled();
    await expectScreenshot('signed-out-finish', {
      target: account,
      zoomPercent: 100,
      ready: () => expect(finish).toBeEnabled()
    });
    await finish.click();
    await expect(account).toBeHidden();

    await page.reload();
    await expect(
      page.getByRole('textbox', { name: italian.NoteCompose, exact: true })
    ).toBeVisible();
    await expect(root).toHaveCSS('color-scheme', 'light');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
);
