import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({ captureWorkflow: 'closing-settings-preserves-the-underlying-route' });

test.browser.stable(
  'persisted zoom keeps notebook scrolling inside the shell',
  async ({ journey: { page, expectScreenshot }, expect }) => {
    await page.goto('/notes');

    const starter = page.getByRole('textbox', { name: copy.NoteCompose, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const scrollHost = page.locator('[data-notebook-scroll-host]');
    const first = editor.getByText(/^Observation 0\./);
    const last = editor.getByText(/^Observation 59\./);

    await expect(page.locator('html')).toHaveCSS('zoom', '1.25');
    await expect(starter).toBeInViewport({ ratio: 1 });
    await starter.fill(
      Array.from(
        { length: 60 },
        (_, i) => `Observation ${i}. ${'Field notes remain readable. '.repeat(20)}`
      ).join('\n\n')
    );
    await expect(page).toHaveURL(/\/notes\/.+/);
    const noteUrl = page.url();

    await expect(editor).toContainText('Observation 59.');

    for (const [zoom, viewport] of [
      [125, { width: 2560, height: 1440 }],
      [100, { width: 2560, height: 1440 }],
      [110, { width: 2240, height: 1260 }]
    ] as const) {
      await page.setViewportSize(viewport);

      if (zoom !== 125) {
        await page.getByRole('button', { name: copy.Settings, exact: true }).click();

        const dialog = page.getByRole('dialog', { name: copy.Settings });

        await dialog.getByRole('button', { name: copy.Appearance, exact: true }).click();

        const slider = dialog.getByRole('slider', { name: copy.TextSize, exact: true });

        if (zoom === 100)
          await dialog
            .getByRole('button', { name: `${copy.ResetSetting}: ${copy.TextSize}`, exact: true })
            .click();

        for (let percent = 105; percent <= zoom; percent += 5) {
          await expect(slider).toBeEnabled();
          await slider.press('ArrowRight');
          await expect(slider).toHaveValue(String(percent));
          await expect(page.locator('html')).toHaveCSS('zoom', String(percent / 100));
        }

        await expect(page.locator('html')).toHaveCSS('zoom', String(zoom / 100));
        await dialog.getByRole('button', { name: copy.Close }).click();
      }

      await first.scrollIntoViewIfNeeded();
      await expect(first).toHaveVisibleText('Observation 0.');
      await last.scrollIntoViewIfNeeded();
      await expect(last).toHaveVisibleText('Observation 59.');
      await expect(scrollHost).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => {
          const shell = await page.locator('.study-shell').boundingBox();
          const workspace = await page.locator('.ui-workspace').boundingBox();

          return (
            !!shell &&
            !!workspace &&
            Math.abs(shell.height - viewport.height) < 1 &&
            Math.abs(workspace.height - shell.height) < 1 &&
            shell.y === 0
          );
        })
        .toBe(true);
      await page.getByRole('combobox', { name: copy.ChooseProject }).click();
      await page.getByRole('link', { name: copy.Projects, exact: true }).click();
      await expect(page.getByRole('heading', { name: copy.Projects })).toBeInViewport({
        ratio: 1
      });
      await page.goto(noteUrl);
      await expect(editor).toContainText('Observation 59.');
      await expect(page.locator('html')).toHaveCSS('zoom', String(zoom / 100));
    }

    // Reuse the existing Settings reference at the canonical profile after exercising persisted changes.
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();

    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog.getByRole('button', { name: copy.Appearance, exact: true }).click();

    const slider = dialog.getByRole('slider', { name: copy.TextSize, exact: true });

    for (let step = 0; step < 3; step++) {
      await expect(slider).toBeEnabled();
      await slider.press('ArrowRight');
      await expect(slider).toHaveValue(String(110 + (step + 1) * 5));
      await expect(page.locator('html')).toHaveCSS('zoom', String((110 + (step + 1) * 5) / 100));
    }

    await dialog.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await dialog.getByRole('button', { name: copy.Appearance, exact: true }).click();
    await expectScreenshot('settings', {
      target: dialog,
      ready: () => expect(dialog).toBeVisible()
    });
  }
);
