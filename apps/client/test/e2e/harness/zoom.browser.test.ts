import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.stable.use({ captureWorkflow: 'closing-settings-preserves-the-underlying-route' });

test.stable(
  'persisted zoom keeps notebook scrolling inside the shell',
  async ({ journey: { page, expectScreenshot } }) => {
    await page.goto('/notes');

    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    await test.expect(page.locator('html')).toHaveCSS('zoom', '1.25');
    await test.expect(composer).toBeInViewport({ ratio: 1 });
    await composer.fill(
      Array.from(
        { length: 60 },
        (_, i) => `Observation ${i}. ${'Field notes remain readable. '.repeat(20)}`
      ).join('\n\n')
    );
    await test.expect(composer).toBeInViewport({ ratio: 1 });
    await test.expect(page.getByRole('button', { name: copy.NoteSaveNote })).toBeInViewport({
      ratio: 1
    });
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await test.expect(page).toHaveURL(/\/notes\/.+/);

    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const body = notebook.locator('.chat-message-text');
    const entry = notebook.getByText(copy.NoteEntryNote, { exact: true });
    const scrollHost = page.locator('[data-notebook-scroll-host]');
    const noteUrl = page.url();

    await test.expect(notebook).toContainText('Observation 59.');

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
          await test.expect(slider).toBeEnabled();
          await slider.press('ArrowRight');
          await test.expect(slider).toHaveValue(String(percent));
          await test.expect(page.locator('html')).toHaveCSS('zoom', String(percent / 100));
        }

        await test.expect(page.locator('html')).toHaveCSS('zoom', String(zoom / 100));
        await dialog.getByRole('button', { name: copy.Close }).click();
      }

      await entry.scrollIntoViewIfNeeded();
      await test.expect(entry).toBeInViewport({ ratio: 1 });
      await scrollHost.press('End');
      await test.expect(entry).not.toBeInViewport();
      await test.expect
        .poll(async () => {
          const text = await body.boundingBox();
          const scroll = await scrollHost.boundingBox();
          const floating = await page.locator('.workspace-desk-floating-composer').boundingBox();

          return (
            !!text &&
            !!scroll &&
            !!floating &&
            text.y + text.height > scroll.y &&
            text.y + text.height <= floating.y
          );
        })
        .toBe(true);
      await test.expect(composer).toBeInViewport({ ratio: 1 });
      await test.expect(page.getByRole('button', { name: copy.NoteSaveNote })).toBeInViewport({
        ratio: 1
      });
      await test.expect
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
      await test.expect(page.getByRole('heading', { name: copy.Projects })).toBeInViewport({
        ratio: 1
      });
      await page.goto(noteUrl);
      await test.expect(notebook).toContainText('Observation 59.');
    }

    // Reuse the existing Settings reference at the canonical profile after exercising persisted changes.
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();

    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog.getByRole('button', { name: copy.Appearance, exact: true }).click();

    const slider = dialog.getByRole('slider', { name: copy.TextSize, exact: true });

    for (let step = 0; step < 3; step++) {
      await test.expect(slider).toBeEnabled();
      await slider.press('ArrowRight');
      await test.expect(slider).toHaveValue(String(110 + (step + 1) * 5));
      await test
        .expect(page.locator('html'))
        .toHaveCSS('zoom', String((110 + (step + 1) * 5) / 100));
    }

    await dialog.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await dialog.getByRole('button', { name: copy.Appearance, exact: true }).click();
    await expectScreenshot('settings', {
      target: dialog,
      ready: () => test.expect(dialog).toBeVisible()
    });
  }
);
