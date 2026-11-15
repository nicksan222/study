import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

testE2e(
  'Closing Settings preserves the underlying route',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await expect(dialog).toBeVisible();
    await expectAccessibility('settings');
    await expectScreenshot('settings', {
      target: dialog,
      ready: () => expect(dialog).toBeVisible()
    });
    await dialog.getByRole('button', { name: copy.Close }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
    await expectAccessibility('composer');
    await expectScreenshot('closed', {
      target: 'viewport',
      ready: () => expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible()
    });
  }
);

testE2e(
  'Writing and reading preferences validate drafts and survive reopening',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const draft = 'A settings round trip must preserve this unsaved observation.';

    await composer.fill(draft);
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.WorkspaceWritingTitle, exact: true }).click();
    const autosave = dialog.getByRole('spinbutton', { name: copy.WorkspaceAutosave, exact: true });
    const saveAutosave = autosave
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: copy.Save, exact: true });

    await expect(autosave).toHaveValue('3');
    await expect(saveAutosave).toBeDisabled();

    for (const invalid of ['', '0', '31', '1.5']) {
      await autosave.fill(invalid);
      await expect(autosave).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('alert')).toHaveText(copy.WorkspaceNumberValidation);
      await expect(saveAutosave).toBeDisabled();
    }

    await expectAccessibility('invalid-writing-preference');
    await expectScreenshot('invalid-autosave', {
      target: dialog,
      ready: () => expect(autosave).toHaveAttribute('aria-invalid', 'true')
    });
    await navigation.getByRole('button', { name: copy.Appearance, exact: true }).click();
    const light = dialog.getByRole('radio', { name: copy.Light, exact: true });

    await light.click();
    await expect(light).toBeChecked();
    await expect(light).toBeEnabled();
    await navigation.getByRole('button', { name: copy.WorkspaceWritingTitle, exact: true }).click();
    await autosave.fill('1.5');
    await expect(autosave).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibility('invalid-writing-light');
    await expectScreenshot('invalid-autosave-light', {
      target: dialog,
      ready: () => expect(autosave).toHaveAttribute('aria-invalid', 'true')
    });
    await autosave.fill('8');
    await expect(autosave).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await autosave.press('Enter');
    await expect(saveAutosave).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText(copy.WorkspaceSettingsSaved);
    const spellcheck = dialog.getByRole('switch', { name: copy.WorkspaceSpellcheck, exact: true });

    await expect(spellcheck).toBeChecked();
    await spellcheck.press('Space');
    await expect(spellcheck).not.toBeChecked();
    await expect(spellcheck).toBeEnabled();
    await expectScreenshot('saved-writing', {
      target: dialog,
      ready: async () => {
        await expect(autosave).toHaveValue('8');
        await expect(spellcheck).not.toBeChecked();
      }
    });
    await navigation.getByRole('button', { name: copy.WorkspaceReadingTitle, exact: true }).click();
    const readerFont = dialog.getByRole('spinbutton', {
      name: copy.WorkspaceReaderFont,
      exact: true
    });

    await readerFont.fill('20');
    await readerFont.press('Enter');
    await expect(
      readerFont
        .locator('xpath=ancestor::form')
        .getByRole('button', { name: copy.Save, exact: true })
    ).toBeDisabled();
    const format = dialog.getByRole('combobox', { name: copy.WorkspaceExportFormat, exact: true });

    await format.click();
    await page.getByRole('option', { name: copy.WorkspaceHtml, exact: true }).click();
    await expect(format).toHaveText(copy.WorkspaceHtml);
    await expect(format).toBeEnabled();
    await dialog.getByRole('button', { name: copy.Close }).click();
    await expect(composer).toHaveValue(draft);
    await expect(composer).toHaveAttribute('spellcheck', 'false');

    await page.reload();
    await composer.fill(draft);
    await expect(composer).toHaveAttribute('spellcheck', 'false');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.WorkspaceReadingTitle, exact: true }).click();
    await expect(readerFont).toHaveValue('20');
    await expect(format).toHaveText(copy.WorkspaceHtml);
    await expectAccessibility('reopened-reading');
    await expectScreenshot('reopened-reading', {
      target: dialog,
      ready: async () => {
        await expect(readerFont).toHaveValue('20');
        await expect(format).toHaveText(copy.WorkspaceHtml);
      }
    });
    await navigation.getByRole('button', { name: copy.WorkspaceWritingTitle, exact: true }).click();
    await expect(autosave).toHaveValue('8');
    await expect(spellcheck).not.toBeChecked();
    await spellcheck.click();
    await expect(spellcheck).toBeChecked();
    await expect(spellcheck).toBeEnabled();
    await dialog.getByRole('button', { name: copy.Close }).click();
    await expect(composer).toHaveValue(draft);
    await expect(composer).toHaveAttribute('spellcheck', 'true');
  }
);

testE2e(
  'Settings search recovers from no matches and follows the persisted language',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    const italian = catalogs.italian;

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/notes');
    const opener = page.getByRole('button', { name: copy.Settings, exact: true });

    await opener.click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const search = dialog.getByRole('searchbox', { name: copy.SearchSettings });
    const results = dialog.getByRole('region', { name: copy.SettingsSearchMatches });

    await search.fill('no-such-setting-928');
    await expect(results.getByRole('status')).toHaveText(copy.SearchNoResults);
    await expect(results.getByRole('button')).toHaveCount(0);
    await expectScreenshot('no-matches', {
      target: dialog,
      ready: () => expect(results.getByRole('status')).toHaveText(copy.SearchNoResults)
    });
    await search.fill(`  ${copy.WorkspaceAutosave.toLocaleUpperCase()}  `);
    const writing = results.getByRole('button', { name: copy.WorkspaceWritingTitle, exact: true });

    await expect(writing).toBeVisible();
    await expectScreenshot('keyword-result', {
      target: dialog,
      ready: () => expect(writing).toBeVisible()
    });
    await writing.press('Enter');
    await expect(search).toHaveValue('');
    await expect(
      dialog.getByRole('spinbutton', { name: copy.WorkspaceAutosave, exact: true })
    ).toBeVisible();
    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.GeneralSettingsTitle, exact: true })
      .click();
    await dialog.getByRole('combobox', { name: copy.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: copy.ItalianOwnName, exact: true }).click();
    const localized = page.getByRole('dialog', { name: italian.Settings });
    const language = localized.getByRole('combobox', { name: italian.GeneralSettingsLanguage });

    await expect(language).toHaveText(italian.ItalianOwnName);
    await expect(language).toBeEnabled();
    await localized.getByRole('button', { name: italian.Close }).click();
    await page.reload();
    await page.getByRole('button', { name: italian.Settings, exact: true }).click();
    const localizedSearch = localized.getByRole('searchbox', { name: italian.SearchSettings });

    await localizedSearch.fill(italian.WorkspaceReaderFont);
    await localized
      .getByRole('region', { name: italian.SettingsSearchMatches })
      .getByRole('button', { name: italian.WorkspaceReadingTitle, exact: true })
      .click();
    await expect(localizedSearch).toHaveValue('');
    const font = localized.getByRole('spinbutton', {
      name: italian.WorkspaceReaderFont,
      exact: true
    });

    await expect(font).toBeVisible();
    await expectAccessibility('italian-reading');
    await expectScreenshot('italian-reading', {
      target: localized,
      ready: () => expect(font).toBeVisible()
    });
    await localizedSearch.press('Escape');
    await expect(localized).toBeHidden();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByRole('button', { name: italian.Settings, exact: true })).toBeFocused();
  }
);

testE2e(
  'Quiz and specialized practice defaults remain independent after reload',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });
    const questionCount = dialog.getByRole('combobox', {
      name: copy.QuizQuestionCount,
      exact: true
    });
    const difficulty = dialog.getByRole('combobox', { name: copy.QuizDifficulty, exact: true });

    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await questionCount.click();
    await page.getByRole('option', { name: '7', exact: true }).click();
    await expect(questionCount).toHaveText('7');
    await expect(questionCount).toBeEnabled();
    await difficulty.click();
    await page.getByRole('option', { name: copy.QuizDifficultyChallenging, exact: true }).click();
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expect(difficulty).toBeEnabled();
    const shuffle = dialog.getByRole('switch', { name: copy.QuizShuffleQuestions, exact: true });

    await shuffle.click();
    await expect(shuffle).toBeChecked();
    await expect(shuffle).toBeEnabled();
    const modes = [
      {
        title: copy.PracticeFillBlank,
        count: '2',
        level: copy.QuizDifficultyEasy,
        screenshot: 'reopened-fill-blank'
      },
      {
        title: copy.PracticeOrdering,
        count: '3',
        level: copy.QuizDifficultyBalanced,
        screenshot: 'reopened-ordering'
      },
      {
        title: copy.PracticeMatching,
        count: '4',
        level: copy.QuizDifficultyEasy,
        screenshot: 'reopened-matching'
      },
      {
        title: copy.PracticeTrueFalse,
        count: '5',
        level: copy.QuizDifficultyBalanced,
        screenshot: 'reopened-true-false'
      }
    ];
    const practiceCount = dialog.getByRole('combobox', {
      name: copy.PracticeSettingsQuestionCount,
      exact: true
    });

    for (const mode of modes) {
      await navigation.getByRole('button', { name: mode.title, exact: true }).click();
      await expect(practiceCount).toHaveText('7');
      await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
      await practiceCount.click();
      await page.getByRole('option', { name: mode.count, exact: true }).click();
      await expect(practiceCount).toHaveText(mode.count);
      await expect(practiceCount).toBeEnabled();
      await difficulty.click();
      await page.getByRole('option', { name: mode.level, exact: true }).click();
      await expect(difficulty).toHaveText(mode.level);
      await expect(difficulty).toBeEnabled();
    }

    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await expect(questionCount).toHaveText('7');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expect(shuffle).toBeChecked();
    await expectAccessibility('reopened-quizzes');
    await expectScreenshot('reopened-quizzes', {
      target: dialog,
      ready: async () => {
        await expect(questionCount).toHaveText('7');
        await expect(shuffle).toBeChecked();
      }
    });

    for (const [index, mode] of modes.entries()) {
      await navigation.getByRole('button', { name: mode.title, exact: true }).click();
      await expect(practiceCount).toHaveText(mode.count);
      await expect(difficulty).toHaveText(mode.level);
      await expect(dialog.getByRole('switch')).toHaveCount(0);
      await expectAccessibility(`practice-${index}`);

      await expectScreenshot(mode.screenshot, {
        target: dialog,
        ready: async () => {
          await expect(practiceCount).toHaveText(mode.count);
          await expect(difficulty).toHaveText(mode.level);
        }
      });
    }
  }
);
