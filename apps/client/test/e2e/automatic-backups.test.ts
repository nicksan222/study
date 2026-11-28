import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Automatic backups can be enabled, run, and paused from Data settings',
  async ({ page, expect, expectAccessibility, expectScreenshot }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog.getByRole('button', { name: copy.DataSettingsTitle, exact: true }).click();
    const destination = dialog.getByRole('combobox', { name: copy.DataAutoBackupDestination });
    const save = dialog.getByRole('button', { name: copy.Save, exact: true });

    await expect(destination).toHaveText(copy.DataAutoBackupOff);
    await expect(destination).toBeEnabled();
    await destination.press('Enter');
    await page.getByRole('option', { name: copy.DataAutoBackupFolder, exact: true }).click();
    const folder = dialog.getByRole('textbox', { name: copy.DataAutoBackupPath });

    await expect(folder).toBeVisible();
    await expect(save).toBeDisabled();
    await expectScreenshot('synced-folder', {
      target: dialog,
      ready: () => expect(folder).toBeVisible()
    });
    await expectAccessibility('synced-folder');
    await destination.click();
    await page.getByRole('option', { name: copy.DataAutoBackupOneDrive, exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: copy.DataAutoBackupClientId })).toBeVisible();
    await expect(
      dialog.getByRole('textbox', { name: copy.DataAutoBackupClientId })
    ).toHaveAttribute('required', '');
    await destination.click();
    await page.getByRole('option', { name: copy.DataBackupS3, exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: copy.DataBackupBucket })).toBeVisible();
    const secret = dialog.locator('input').and(dialog.getByLabel(copy.DataBackupSecretKey));

    await expect(secret).toHaveAttribute('type', 'password');
    await secret.scrollIntoViewIfNeeded();
    await expectScreenshot('s3-destination', {
      target: dialog,
      ready: () =>
        expect(dialog.getByRole('textbox', { name: copy.DataBackupBucket })).toBeVisible()
    });
    await expectAccessibility('s3-destination');
    await destination.click();
    await page.getByRole('option', { name: copy.DataAutoBackupLocal, exact: true }).click();
    await dialog.getByRole('button', { name: copy.DataAutoBackupEnable }).click();
    const run = dialog.getByRole('button', { name: copy.DataAutoBackupRun, exact: true });

    await expect(run).toBeEnabled();
    await run.click();
    await expect(dialog.getByText(copy.DataAutoBackupWaiting, { exact: true })).toHaveCount(0);
    await expect(dialog.getByText(copy.DataAutoBackupRunFailed, { exact: true })).toHaveCount(0);
    await expect(run).toBeEnabled();
    await expect(destination).toHaveCount(0);
    await dialog.getByRole('button', { name: copy.DataAutoBackupChange }).click();
    await destination.press('Enter');
    await page.getByRole('option', { name: copy.DataAutoBackupOff, exact: true }).click();
    await dialog.getByRole('button', { name: copy.DataAutoBackupTurnOff }).click();
    await expect(run).toHaveCount(0);
    await dialog.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await dialog.getByRole('combobox', { name: copy.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: copy.ItalianOwnName, exact: true }).click();
    await page.setViewportSize({ width: 480, height: 845 });
    const italian = catalogs.italian;
    const localized = page.getByRole('dialog', { name: italian.Settings });

    await localized.getByRole('button', { name: italian.DataSettingsTitle, exact: true }).click();
    const localizedDestination = localized.getByRole('combobox', {
      name: italian.DataAutoBackupDestination
    });

    await expect(localizedDestination).toHaveText(italian.DataAutoBackupOff);
    await localizedDestination.click();
    await page.getByRole('option', { name: italian.DataAutoBackupFolder, exact: true }).click();
    await expect(
      localized.getByRole('textbox', { name: italian.DataAutoBackupPath })
    ).toBeVisible();
  }
);
