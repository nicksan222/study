import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

const italian = catalogs.italian;

const opening = 'pianeta🌿 — Caffè, città e perché. 👩🏽‍🔬 東京の研究。 مرحبًا بالعالم';

const paragraphs = Array.from(
  { length: 24 },
  (_, index) =>
    `Osservazione ${index + 1}. Il gruppo annota la qualità dell’acqua, l’umidità e le possibilità del giardino. ` +
    'We preserve the original words so another reader can compare each observation with the next season. ' +
    'Una ricercatrice 👩🏽‍🔬 misura le foglie 🌿 e registra i risultati con attenzione. ' +
    '東京の庭で植物を観察します。 中文记录保留原文。 مرحبًا بالعالم، هذه ملاحظات الحديقة. ' +
    'La lettura continua senza perdere accenti, spazi o caratteri: è già un buon risultato. '
);

const original = [
  opening,
  'Ricerca iniziale: lucciolacittà. English field journal.',
  ...paragraphs,
  'Ultima riga: finché c’è luce, il giardino cresce. 🌍 家族 👨‍👩‍👧‍👦 نهاية الملاحظات.'
].join('\n\n');

testE2e(
  'Bilingual notes preserve Unicode edits search and locale changes',
  async ({ page, expectScreenshot }) => {
    await page.goto('/notes');
    expect(page.viewportSize()).toEqual({ width: 2560, height: 1440 });
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    await composer.fill(original);
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    const noteUrl = page.url();
    const notePath = new URL(noteUrl).pathname;
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const body = notebook.locator('.chat-message-text');
    const entry = notebook.getByText(copy.NoteEntryNote, { exact: true });
    const scrollHost = page.locator('[data-notebook-scroll-host]');

    await expect.poll(() => body.textContent()).toBe(original);
    await entry.scrollIntoViewIfNeeded();
    await expect(entry).toBeInViewport({ ratio: 1 });
    await expectScreenshot('mixed-scripts', {
      target: 'viewport',
      ready: async () => {
        await expect(body).toHaveText(original);
        await expect(entry).toBeInViewport({ ratio: 1 });
      }
    });

    const top = await body.boundingBox();

    await scrollHost.press('PageDown');
    await expect.poll(async () => (await body.boundingBox())!.y).toBeLessThan(top!.y - 100);
    const middle = await body.boundingBox();

    await expect(body).toBeInViewport();
    await scrollHost.press('End');
    await expect.poll(async () => (await body.boundingBox())!.y).toBeLessThan(middle!.y - 100);
    await expect(entry).not.toBeInViewport();
    await expect
      .poll(async () => {
        const text = await body.boundingBox();
        const floating = await page.locator('.workspace-desk-floating-composer').boundingBox();

        return !!text && !!floating && text.y + text.height <= floating.y;
      })
      .toBe(true);
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: copy.NoteSaveNote })).toBeInViewport({
      ratio: 1
    });
    await expectScreenshot('mixed-scripts-bottom', {
      target: 'viewport',
      ready: async () => {
        await expect(body).toHaveText(original);
        await expect(entry).not.toBeInViewport();
        await expect(composer).toBeInViewport({ ratio: 1 });
      }
    });

    await page.goto('/notes');
    const initialSearch = page.getByRole('searchbox', { name: copy.Search, exact: true });

    await initialSearch.fill('lucciolacittà');
    const initialResult = page
      .locator(`a[href="${notePath}"]`)
      .filter({ hasText: 'lucciolacittà' });

    await expect(initialResult).toHaveCount(1);
    await initialResult.click();
    await expect(page).toHaveURL(noteUrl);

    await expect.poll(() => body.textContent()).toBe(original);

    let content = original;

    for (const [index, [before, after]] of [
      ['pianeta🌿', 'g🌿'],
      ['lucciolacittà', 'lucciolaperché'],
      ['東京の庭で植物を観察します。', '京都の庭で植物を観察します。']
    ].entries()) {
      await notebook.locator('[data-role="user"]').hover();
      await page.getByRole('button', { name: copy.NoteEditNote }).click();
      const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
      const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

      await expect(editor).toHaveValue(content);
      content = content.replace(before!, after!);

      if (index === 0) {
        // Select only the Latin word touching the emoji, using real keyboard selection.
        await editor.click();
        await editor.press('ControlOrMeta+a');
        await editor.press('ArrowLeft');

        for (let letter = 0; letter < 7; letter++) await editor.press('Shift+ArrowRight');

        await editor.press('g');

        await expect(editor).toHaveValue(content);
        await expect(editor).toBeFocused();
        await expect(editor.locator(':scope:focus-visible')).toHaveCount(1);
        const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

        await editor.press('Tab');
        await expect(save).toBeFocused();
        await expect(save).toBeInViewport({ ratio: 1 });
        await expect(save.locator(':scope:focus-visible')).toHaveCount(1);
        await save.press('Shift+Tab');
        await editor.press('ControlOrMeta+a');
        await editor.press('ArrowLeft');
        await expectScreenshot('selection-edit', {
          target: dialog,
          ready: async () => {
            await expect(editor).toHaveValue(content);
            await expect(editor).toBeFocused();
            await expect(save).toBeInViewport({ ratio: 1 });
          }
        });
      } else await editor.fill(content);

      await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => body.textContent()).toBe(content);
      await page.reload();
      await expect.poll(() => body.textContent()).toBe(content);
    }

    await page.goto('/notes');
    await composer.fill('Second notebook: an independent English observation.');
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    expect(page.url()).not.toBe(noteUrl);
    const secondUrl = page.url();
    const search = page.getByRole('searchbox', { name: copy.Search, exact: true });
    const result = page.locator(`a[href="${notePath}"]`).filter({ hasText: 'lucciolaperché' });

    for (const token of ['nessunrisultatounicode', 'lucciolacittà']) {
      await search.fill('lucciolaperché');
      await expect(result).toHaveCount(1);
      await search.fill(token);
      await expect(
        page.getByRole('status').filter({ hasText: copy.SearchNoResults })
      ).toBeVisible();
    }

    await search.fill('lucciolaperché');

    await expect(result).toHaveCount(1);
    await expect(result).toBeInViewport({ ratio: 1 });
    await expectScreenshot('search-edited', {
      target: 'viewport',
      ready: async () => {
        await expect(result).toBeVisible();
        await expect(search).toHaveValue('lucciolaperché');
      }
    });
    await result.click();
    await expect(page).toHaveURL(noteUrl);
    await expect.poll(() => body.textContent()).toBe(content);

    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await page
      .getByRole('dialog', { name: copy.Settings })
      .getByRole('button', { name: copy.GeneralSettingsTitle, exact: true })
      .click();
    await page.getByRole('combobox', { name: copy.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: copy.ItalianOwnName }).click();
    const settings = page.getByRole('dialog', { name: italian.Settings });

    await expect(
      settings.getByRole('combobox', { name: italian.GeneralSettingsLanguage })
    ).toHaveText(italian.ItalianOwnName);

    await expect(
      settings.getByRole('combobox', { name: italian.GeneralSettingsLanguage })
    ).toBeEnabled();
    await settings.getByRole('button', { name: italian.Close }).click();
    await page.goto(secondUrl);
    await page.reload();
    await expect(page.getByRole('textbox', { name: italian.NoteCompose })).toBeVisible();
    await page.getByRole('searchbox', { name: italian.Search, exact: true }).fill('lucciolaperché');
    await page.locator(`a[href="${notePath}"]`).filter({ hasText: 'lucciolaperché' }).click();
    await expect(page).toHaveURL(noteUrl);
    const localizedNotebook = page.getByRole('region', { name: italian.NoteNotebook });

    await expect
      .poll(() => localizedNotebook.locator('.chat-message-text').textContent())
      .toBe(content);
    const localizedEntry = localizedNotebook.getByText(italian.NoteEntryNote, { exact: true });

    await localizedEntry.scrollIntoViewIfNeeded();
    await expectScreenshot('localized-reopened', {
      target: 'viewport',
      ready: async () => {
        await expect(localizedEntry).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: italian.NoteSaveNote })).toBeInViewport({
          ratio: 1
        });
        await expect(localizedNotebook.locator('.chat-message-text')).toHaveText(content);
      }
    });
    await page.getByRole('button', { name: italian.Settings, exact: true }).click();
    await page
      .getByRole('dialog', { name: italian.Settings })
      .getByRole('button', { name: italian.GeneralSettingsTitle, exact: true })
      .click();
    await expect(page.getByRole('combobox', { name: italian.GeneralSettingsLanguage })).toHaveText(
      italian.ItalianOwnName
    );
  }
);
