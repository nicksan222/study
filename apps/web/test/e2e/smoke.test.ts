import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { withWebE2e } from './harness/index.ts';

const copy = catalogs.english;

testStable('home opens Notes and sidebar navigation reaches Projects', async () => {
  await withWebE2e(async ({ page }) => {
    await page.goto('/home');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe('/notes');
    await page.getByRole('combobox', { name: copy.ChooseProject }).click();
    await page.getByRole('link', { name: copy.Projects, exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/projects');
    await expect
      .poll(() => page.getByRole('heading', { name: copy.Projects }).isVisible())
      .toBe(true);
  });
});

testStable('closing Settings preserves the underlying route', async () => {
  await withWebE2e(async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await expect.poll(() => dialog.isVisible()).toBe(true);
    await dialog.getByRole('button', { name: copy.Close }).click();
    await expect.poll(() => dialog.isVisible()).toBe(false);
    expect(new URL(page.url()).pathname).toBe('/notes');
  });
});

testStable('created and edited note content survives a reload', async () => {
  await withWebE2e(async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('textbox', { name: copy.NoteCompose }).fill('A first note');
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/notes\/.+/);
    await page.getByRole('button', { name: copy.NoteEditNote }).focus();
    await page.keyboard.press('Enter');
    const editor = page.getByRole('textbox', { name: copy.NoteEditNote });

    await editor.fill('An edited note');
    await page
      .getByRole('dialog', { name: copy.NoteEditNote })
      .getByRole('button', { name: copy.NoteSaveNote })
      .click();
    await expect
      .poll(() => page.getByRole('dialog', { name: copy.NoteEditNote }).isVisible(), {
        timeout: 20000
      })
      .toBe(false);
    await expect
      .poll(
        () =>
          page
            .getByRole('region', { name: copy.NoteNotebook })
            .getByText('An edited note')
            .isVisible(),
        { timeout: 20000 }
      )
      .toBe(true);
    await page.reload();
    await expect
      .poll(
        () =>
          page
            .getByRole('region', { name: copy.NoteNotebook })
            .getByText('An edited note')
            .isVisible(),
        { timeout: 20000 }
      )
      .toBe(true);
  });
});
