import { Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

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

test.browser.stable(
  'Bilingual notes preserve Unicode edits search and locale changes',
  async ({ page, rpc, expectScreenshot, expectAccessibility, expect }) => {
    const preferences = await rpc.runPromise(rpc.client['settings.workspacePreferences']({}));

    await rpc.runPromise(
      rpc.client['settings.saveWorkspacePreferences']({
        ...preferences,
        autosaveIntervalSeconds: 1
      })
    );

    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const status = page.getByRole('status').filter({ hasText: /^Saved$/ });

    await starter.fill(original);
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    const noteUrl = page.url();
    const notePath = new URL(noteUrl).pathname;
    const start = editor.getByText(opening, { exact: true });

    await start.scrollIntoViewIfNeeded();
    await expectScreenshot('mixed-scripts', {
      target: 'viewport',
      ready: () => expect(start).toBeInViewport()
    });

    const changed = original
      .replace('lucciolacittà', 'lucciolaperché')
      .replace('東京の庭で植物を観察します。', '東京の温室で植物を観察します。')
      .replace('نهاية الملاحظات.', 'نهاية السجل.');

    await editor.fill(changed);
    await expect(status).toBeVisible();
    await page.goto('/notes');
    await starter.fill('Second notebook: an independent English observation.');
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    expect(page.url()).not.toBe(noteUrl);

    const search = page.getByRole('searchbox', { name: copy.Search, exact: true });
    const result = page.locator(`a[href="${notePath}"]`).filter({ hasText: 'lucciolaperché' });

    await search.fill('lucciolacittà');
    await expect(page.getByRole('status').filter({ hasText: copy.SearchNoResults })).toBeVisible();
    await search.fill('lucciolaperché');
    await expectScreenshot('search-edited', {
      target: 'viewport',
      ready: () => expect(result).toBeVisible()
    });
    await result.click();
    await expect(page).toHaveURL(noteUrl);
    await expect(editor).toContainText('東京の温室で植物を観察します。');
    await expect(editor).toContainText('نهاية السجل.');

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
    );
    await page.reload();
    await page.setViewportSize({ width: 390, height: 520 });
    const localized = page.getByRole('textbox', { name: italian.NotePageEditor, exact: true });
    const end = localized.locator('p').last();

    await expect(localized).toContainText(opening);
    await end.hover();
    await expect(end).toContainText('👨‍👩‍👧‍👦 نهاية السجل.');
    await expectScreenshot('localized-reopened', {
      target: 'viewport',
      ready: () => expect(end).toBeInViewport()
    });
    await expectAccessibility('italian-notebook');
  }
);
