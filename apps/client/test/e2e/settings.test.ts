import { maxAgentRuleLength } from '@study/contracts/settings/schemas';
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
  'Writing settings validate every number and apply capture and page preferences',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const draft = 'An unsent field observation survives opening and closing settings.';

    await composer.fill(draft);
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });
    const writing = navigation.getByRole('button', {
      name: copy.WorkspaceWritingTitle,
      exact: true
    });

    await writing.click();
    const autosave = dialog.getByRole('spinbutton', { name: copy.WorkspaceAutosave, exact: true });
    const saveAutosave = autosave.locator('xpath=ancestor::form').getByRole('button');
    const font = dialog.getByRole('spinbutton', { name: copy.WorkspaceEditorFont, exact: true });
    const saveFont = font.locator('xpath=ancestor::form').getByRole('button');
    const spellcheck = dialog.getByRole('switch', { name: copy.WorkspaceSpellcheck, exact: true });
    const enterCapture = dialog.getByRole('switch', {
      name: copy.WorkspaceEnterCapture,
      exact: true
    });
    const expand = dialog.getByRole('switch', { name: copy.WorkspaceExpandPages, exact: true });

    await expect(autosave).toHaveValue('3');
    await expect(font).toHaveValue('16');
    await expect(saveAutosave).toBeDisabled();
    await expect(saveFont).toBeDisabled();
    await expect(spellcheck).toBeChecked();
    await expect(enterCapture).not.toBeChecked();
    await expect(expand).not.toBeChecked();
    await expectScreenshot('writing-defaults', {
      target: dialog,
      ready: () => expect(font).toHaveValue('16')
    });

    for (const [name, value] of [
      ['empty', ''],
      ['below-minimum', '0'],
      ['above-maximum', '31'],
      ['fractional', '1.5']
    ] as const) {
      await autosave.fill(value);
      await expect(autosave).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('alert')).toHaveText(copy.WorkspaceNumberValidation);
      await expect(saveAutosave).toBeDisabled();
      await expectScreenshot(`autosave-invalid-${name}`, {
        target: dialog,
        ready: () => expect(saveAutosave).toBeDisabled()
      });
    }

    await expectAccessibility('writing-invalid-dark');
    await navigation.getByRole('button', { name: copy.Appearance, exact: true }).click();
    const light = dialog.getByRole('radio', { name: copy.Light, exact: true });

    await light.click();
    await expect(light).toBeChecked();
    await expect(light).toBeEnabled();
    await writing.click();
    await autosave.fill('1.5');
    await expect(autosave).toHaveAttribute('aria-invalid', 'true');
    await expectAccessibility('writing-invalid-light');
    await expectScreenshot('autosave-invalid-light', {
      target: dialog,
      ready: () => expect(autosave).toHaveAttribute('aria-invalid', 'true')
    });

    for (const value of ['1', '30', '8']) {
      await autosave.fill(value);
      await expect(autosave).toHaveAttribute('aria-invalid', 'false');
      await expect(saveAutosave).toBeEnabled();
      await autosave.press('Enter');
      await expect(saveAutosave).toBeDisabled();
      await expect(autosave).toBeEnabled();
      await expect(dialog.getByRole('status')).toHaveText(copy.WorkspaceSettingsSaved);
      await expectScreenshot(`autosave-saved-${value}`, {
        target: dialog,
        ready: () => expect(autosave).toHaveValue(value)
      });
    }

    for (const [name, value] of [
      ['empty', ''],
      ['negative', '-1'],
      ['below-minimum', '13'],
      ['above-maximum', '25'],
      ['fractional', '14.5']
    ] as const) {
      await font.fill(value);
      await expect(font).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('alert')).toHaveText(copy.WorkspaceNumberValidation);
      await expect(saveFont).toBeDisabled();
      await expectScreenshot(`editor-font-invalid-${name}`, {
        target: dialog,
        ready: () => expect(font).toHaveAttribute('aria-invalid', 'true')
      });
    }

    for (const value of ['14', '24']) {
      await font.fill(value);
      await expect(font).toHaveAttribute('aria-invalid', 'false');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await saveFont.click();
      await expect(saveFont).toBeDisabled();
      await expect(font).toBeEnabled();
      await expectScreenshot(`editor-font-saved-${value}`, {
        target: dialog,
        ready: () => expect(font).toHaveValue(value)
      });
    }

    for (const [name, control, checked] of [
      ['spellcheck-off', spellcheck, false],
      ['enter-capture-on', enterCapture, true],
      ['expand-pages-on', expand, true]
    ] as const) {
      await control.press('Space');
      await expect(control).toBeChecked({ checked });
      await expect(control).toBeEnabled();
      await expectScreenshot(name, {
        target: dialog,
        ready: () => expect(control).toBeChecked({ checked })
      });
    }

    await dialog.getByRole('button', { name: copy.Close }).click();
    await expect(composer).toHaveValue(draft);
    await expect(composer).toHaveAttribute('spellcheck', 'false');
    await composer.press('ControlOrMeta+End');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue(draft + '\n');
    await expect(page).toHaveURL(/\/notes$/);
    await expectScreenshot('shift-enter-keeps-starter-draft', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(draft + '\n')
    });
    await composer.fill(draft);
    await composer.press('Enter');
    await expect(page).toHaveURL(/\/notes\/.+/);
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const entries = notebook.locator('.chat-message-text');

    await expect(entries).toHaveText([draft]);
    await composer.fill('A second observation captured from the existing notebook.');
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    await expect(entries).toHaveText([
      draft,
      'A second observation captured from the existing notebook.'
    ]);
    await expectScreenshot('enter-captures-existing-note', {
      target: 'viewport',
      ready: () => expect(entries).toHaveCount(2)
    });
    await page.getByRole('button', { name: copy.NoteWritePage, exact: true }).click();
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await expect(editor).toBeVisible();
    await expect(editor).toHaveCSS('font-size', '24px');
    await expect(
      page.getByRole('button', { name: copy.NoteRestoreEditor, exact: true })
    ).toBeVisible();
    await expectScreenshot('expanded-page-large-editor-font', {
      target: 'viewport',
      ready: () => expect(editor).toHaveCSS('font-size', '24px')
    });

    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await writing.click();
    await expect(font).toHaveValue('24');
    await expect(autosave).toHaveValue('8');

    for (const [name, control, checked] of [
      ['spellcheck-on', spellcheck, true],
      ['enter-capture-off', enterCapture, false],
      ['expand-pages-off', expand, false]
    ] as const) {
      await control.click();
      await expect(control).toBeChecked({ checked });
      await expect(control).toBeEnabled();
      await expectScreenshot(name, {
        target: dialog,
        ready: () => expect(control).toBeChecked({ checked })
      });
    }

    await expect(spellcheck).toBeChecked();
    await expect(enterCapture).not.toBeChecked();
    await expect(expand).not.toBeChecked();
    await expectScreenshot('writing-behaviors-restored', {
      target: dialog,
      ready: () => expect(expand).not.toBeChecked()
    });
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.reload();
    await expect(composer).toHaveAttribute('spellcheck', 'true');
    await composer.fill('Enter now inserts a newline rather than capturing.');
    await composer.press('ControlOrMeta+End');
    await composer.press('Enter');
    await expect(composer).toHaveValue('Enter now inserts a newline rather than capturing.\n');
    await expect(entries).toHaveCount(2);
    await expectScreenshot('enter-inserts-newline-after-reload', {
      target: 'viewport',
      ready: () => expect(entries).toHaveCount(2)
    });
    await composer.press('ControlOrMeta+Enter');
    await expect(entries).toHaveCount(3);
    await expect(composer).toHaveValue('');
    await page.getByRole('button', { name: copy.NoteWritePage, exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveCSS('font-size', '24px');
    await expect(
      page.getByRole('button', { name: copy.NoteExpandEditor, exact: true })
    ).toBeVisible();
    await expectScreenshot('unexpanded-page-after-reload', {
      target: 'viewport',
      ready: () => expect(editor).toBeVisible()
    });
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await writing.click();
    await expect(autosave).toHaveValue('8');
    await expect(font).toHaveValue('24');
    await expect(spellcheck).toBeChecked();
    await expect(enterCapture).not.toBeChecked();
    await expect(expand).not.toBeChecked();
    await expectAccessibility('writing-persisted');
    await expectScreenshot('writing-persisted', {
      target: dialog,
      ready: () => expect(autosave).toHaveValue('8')
    });
  }
);

testE2e(
  'Sidebar settings apply display preferences and validate settlement limits',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page
      .getByRole('textbox', { name: copy.NoteCompose })
      .fill('Sidebar presentation sample.');
    await page.getByRole('button', { name: copy.NoteSaveNote, exact: true }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    const notePath = new URL(page.url()).pathname;
    const row = page
      .getByRole('navigation', { name: copy.Notes, exact: true })
      .locator(`a[href="${notePath}"]`);
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const sidebar = dialog
      .getByRole('navigation', { name: copy.Settings })
      .getByRole('button', { name: copy.SettingsSidebar, exact: true });

    await expect(row).toHaveAttribute('data-layout', 'detailed');
    await expect(row.getByTitle(copy.SidebarGeneratedPages, { exact: true })).toBeVisible();
    await expectScreenshot('sidebar-comfortable-relative-counts', {
      target: 'viewport',
      ready: () => expect(row).toHaveAttribute('data-layout', 'detailed')
    });

    for (const [name, density, layout, time, counts, expectedCount] of [
      [
        'compact-absolute-hidden-counts',
        copy.WorkspaceCompact,
        'compact',
        copy.WorkspaceAbsoluteTime,
        false,
        0
      ],
      [
        'comfortable-relative-visible-counts',
        copy.WorkspaceComfortable,
        'detailed',
        copy.WorkspaceRelativeTime,
        true,
        1
      ]
    ] as const) {
      await page.getByRole('button', { name: copy.Settings, exact: true }).click();
      await sidebar.click();

      for (const [control, label, value] of [
        ['density', copy.WorkspaceDensity, density],
        ['time', copy.WorkspaceTimeFormat, time]
      ] as const) {
        const select = dialog.getByRole('combobox', { name: label, exact: true });

        await select.click();
        await expectScreenshot(`sidebar-${name}-${control}-options`, {
          target: 'viewport',
          ready: () => expect(page.getByRole('option', { name: value, exact: true })).toBeVisible()
        });
        await page.getByRole('option', { name: value, exact: true }).click();
        await expect(select).toHaveText(value);
        await expect(select).toBeEnabled();
        await expectScreenshot(`sidebar-${name}-${control}-saved`, {
          target: dialog,
          ready: () => expect(select).toHaveText(value)
        });
      }

      const showCounts = dialog.getByRole('switch', {
        name: copy.WorkspacePageCounts,
        exact: true
      });

      await showCounts.press('Space');
      await expect(showCounts).toBeChecked({ checked: counts });
      await expect(showCounts).toBeEnabled();
      await expectScreenshot(`sidebar-${name}-saved`, {
        target: dialog,
        ready: () => expect(showCounts).toBeChecked({ checked: counts })
      });
      await dialog.getByRole('button', { name: copy.Close }).click();
      await expect(row).toHaveAttribute('data-layout', layout);
      await expect(row.getByTitle(copy.SidebarGeneratedPages, { exact: true })).toHaveCount(
        expectedCount
      );

      if (time === copy.WorkspaceAbsoluteTime) {
        await expect(row.locator('time')).toHaveText(
          (await row.locator('time').getAttribute('title')) ?? ''
        );
      } else {
        await expect(row.locator('time')).not.toHaveText(
          (await row.locator('time').getAttribute('title')) ?? ''
        );
      }

      await expectScreenshot(`sidebar-${name}-applied`, {
        target: 'viewport',
        ready: () => expect(row).toHaveAttribute('data-layout', layout)
      });
      await page.reload();
      await expect(row).toHaveAttribute('data-layout', layout);
      await expect(row.getByTitle(copy.SidebarGeneratedPages, { exact: true })).toHaveCount(
        expectedCount
      );
    }

    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await sidebar.click();
    const threshold = dialog.getByRole('spinbutton', {
      name: copy.SidebarSettledThreshold,
      exact: true
    });
    const save = threshold.locator('xpath=ancestor::form').getByRole('button');

    await expect(threshold).toHaveValue('1');
    await expect(save).toBeDisabled();

    for (const [name, value] of [
      ['empty', ''],
      ['negative', '-1'],
      ['zero', '0'],
      ['above-maximum', '101'],
      ['fractional', '1.5']
    ] as const) {
      await threshold.fill(value);
      await expect(threshold).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('alert')).toHaveText(copy.SidebarSettledValidation);
      await expect(save).toBeDisabled();
      await expectScreenshot(`settlement-invalid-${name}`, {
        target: dialog,
        ready: () => expect(threshold).toHaveAttribute('aria-invalid', 'true')
      });
    }

    await expectAccessibility('sidebar-invalid-threshold');

    for (const value of ['100', '1', '7']) {
      await threshold.fill(value);
      await expect(threshold).toHaveAttribute('aria-invalid', 'false');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(save).toBeEnabled();
      await threshold.press('Enter');
      await expect(save).toBeDisabled();
      await expect(threshold).toBeEnabled();
      await expectScreenshot(`settlement-saved-${value}`, {
        target: dialog,
        ready: () => expect(threshold).toHaveValue(value)
      });
    }

    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await sidebar.click();
    await expect(threshold).toHaveValue('7');
    await expect(
      dialog.getByRole('combobox', { name: copy.WorkspaceDensity, exact: true })
    ).toHaveText(copy.WorkspaceComfortable);
    await expect(
      dialog.getByRole('combobox', { name: copy.WorkspaceTimeFormat, exact: true })
    ).toHaveText(copy.WorkspaceRelativeTime);
    await expect(
      dialog.getByRole('switch', { name: copy.WorkspacePageCounts, exact: true })
    ).toBeChecked();
    await expectAccessibility('sidebar-persisted');
    await expectScreenshot('sidebar-persisted', {
      target: dialog,
      ready: () => expect(threshold).toHaveValue('7')
    });
  }
);

testE2e(
  'Reading settings reject invalid font sizes and persist every export format',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const reading = dialog
      .getByRole('navigation', { name: copy.Settings })
      .getByRole('button', { name: copy.WorkspaceReadingTitle, exact: true });

    await reading.click();
    const font = dialog.getByRole('spinbutton', { name: copy.WorkspaceReaderFont, exact: true });
    const save = font.locator('xpath=ancestor::form').getByRole('button');
    const format = dialog.getByRole('combobox', { name: copy.WorkspaceExportFormat, exact: true });

    await expect(font).toHaveValue('16');
    await expect(save).toBeDisabled();
    await expect(format).toHaveText(copy.WorkspaceMarkdown);
    await expectScreenshot('reading-defaults', {
      target: dialog,
      ready: () => expect(font).toHaveValue('16')
    });

    for (const [name, value] of [
      ['empty', ''],
      ['negative', '-1'],
      ['below-minimum', '13'],
      ['above-maximum', '25'],
      ['fractional', '14.5']
    ] as const) {
      await font.fill(value);
      await expect(font).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('alert')).toHaveText(copy.WorkspaceNumberValidation);
      await expect(save).toBeDisabled();
      await expectScreenshot(`reader-font-invalid-${name}`, {
        target: dialog,
        ready: () => expect(font).toHaveAttribute('aria-invalid', 'true')
      });
    }

    await expectAccessibility('reading-invalid-font');

    for (const value of ['14', '24', '20']) {
      await font.fill(value);
      await expect(font).toHaveAttribute('aria-invalid', 'false');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(save).toBeEnabled();
      await font.press('Enter');
      await expect(save).toBeDisabled();
      await expect(font).toBeEnabled();
      await expectScreenshot(`reader-font-saved-${value}`, {
        target: dialog,
        ready: () => expect(font).toHaveValue(value)
      });
    }

    await format.click();
    await expect(page.getByRole('option')).toHaveText([
      copy.WorkspaceMarkdown,
      copy.WorkspaceHtml,
      copy.WorkspacePageJson,
      copy.ExportCsv
    ]);
    await expectScreenshot('export-format-options', {
      target: 'viewport',
      ready: () => expect(page.getByRole('option')).toHaveCount(4)
    });
    await format.press('Escape');

    for (const [name, label] of [
      ['html', copy.WorkspaceHtml],
      ['page-json', copy.WorkspacePageJson],
      ['csv', copy.ExportCsv],
      ['markdown', copy.WorkspaceMarkdown]
    ] as const) {
      await format.click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(format).toHaveText(label);
      await expect(format).toBeEnabled();
      await expectScreenshot(`export-format-${name}`, {
        target: dialog,
        ready: () => expect(format).toHaveText(label)
      });
      await dialog.getByRole('button', { name: copy.Close }).click();
      await page.reload();
      await page.getByRole('button', { name: copy.Settings, exact: true }).click();
      await reading.click();
      await expect(format).toHaveText(label);
      await expect(font).toHaveValue('20');
      await expect(save).toBeDisabled();
    }

    await expectAccessibility('reading-persisted');
    await expectScreenshot('reading-persisted', {
      target: dialog,
      ready: () => expect(font).toHaveValue('20')
    });
  }
);

testE2e(
  'Automation settings persist detail conversion and automatic behavior',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const automation = dialog
      .getByRole('navigation', { name: copy.Settings })
      .getByRole('button', { name: copy.SettingsAiBehavior, exact: true });

    await automation.click();
    const detail = dialog.getByRole('combobox', { name: copy.WorkspaceAiDetail, exact: true });
    const conversion = dialog.getByRole('combobox', {
      name: copy.WorkspaceConversionMode,
      exact: true
    });
    const strategy = dialog.getByRole('combobox', {
      name: copy.WorkspaceConversionStrategy,
      exact: true
    });
    const titles = dialog.getByRole('switch', { name: copy.WorkspaceAutoTitles, exact: true });
    const answers = dialog.getByRole('switch', {
      name: copy.WorkspaceAutoAnswerQuestions,
      exact: true
    });

    await expect(detail).toHaveText(copy.NoteDetailBalanced);
    await expect(conversion).toHaveText(copy.WorkspaceConversionManual);
    await expect(strategy).toHaveText(copy.ConversionChatGpt);
    await expect(strategy).toBeDisabled();
    await expect(titles).not.toBeChecked();
    await expect(answers).not.toBeChecked();
    await expectScreenshot('automation-defaults', {
      target: dialog,
      ready: () => expect(strategy).toHaveText(copy.ConversionChatGpt)
    });

    for (const [name, select, labels] of [
      ['detail', detail, [copy.NoteDetailBrief, copy.NoteDetailDetailed, copy.NoteDetailBalanced]],
      [
        'conversion',
        conversion,
        [copy.WorkspaceConversionAutomatic, copy.WorkspaceConversionManual]
      ]
    ] as const) {
      for (const [index, label] of labels.entries()) {
        await select.click();
        await expect(page.getByRole('option')).toHaveCount(labels.length);
        await expectScreenshot(`automation-${name}-options-${index}`, {
          target: 'viewport',
          ready: () => expect(page.getByRole('option', { name: label, exact: true })).toBeVisible()
        });
        await page.getByRole('option', { name: label, exact: true }).click();
        await expect(select).toHaveText(label);
        await expect(select).toBeEnabled();
        await expectScreenshot(`automation-${name}-saved-${index}`, {
          target: dialog,
          ready: () => expect(select).toHaveText(label)
        });
        await dialog.getByRole('button', { name: copy.Close }).click();
        await page.reload();
        await page.getByRole('button', { name: copy.Settings, exact: true }).click();
        await automation.click();
        await expect(select).toHaveText(label);
        await expect(strategy).toHaveText(copy.ConversionChatGpt);
        await expect(strategy).toBeDisabled();
      }
    }

    for (const checked of [true, false]) {
      for (const [name, toggle] of [
        ['titles', titles],
        ['answers', answers]
      ] as const) {
        await toggle.press('Space');
        await expect(toggle).toBeChecked({ checked });
        await expect(toggle).toBeEnabled();
        await expectScreenshot(`automatic-${name}-${checked ? 'on' : 'off'}`, {
          target: dialog,
          ready: () => expect(toggle).toBeChecked({ checked })
        });
      }

      await dialog.getByRole('button', { name: copy.Close }).click();
      await page.reload();
      await page.getByRole('button', { name: copy.Settings, exact: true }).click();
      await automation.click();
      await expect(titles).toBeChecked({ checked });
      await expect(answers).toBeChecked({ checked });
      await expectScreenshot(`automation-persisted-${checked ? 'on' : 'off'}`, {
        target: dialog,
        ready: () => expect(answers).toBeChecked({ checked })
      });
    }

    await expectAccessibility('automation-persisted');
  }
);

testE2e(
  'Flashcards settings validate daily limits and persist review preferences',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.Flashcards, exact: true }).click();
    const limit = dialog.getByRole('spinbutton', { name: copy.StudySettingsNewCards, exact: true });
    const save = limit
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: copy.Save, exact: true });

    await expect(limit).toHaveValue('20');
    await expect(save).toBeDisabled();
    await expectScreenshot('flashcards-default', {
      target: dialog,
      ready: () => expect(limit).toHaveValue('20')
    });

    for (const [index, invalid] of ['', '-1', '10001', '1.5'].entries()) {
      await limit.fill(invalid);
      await expect(limit).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('alert')).toHaveText(copy.StudySettingsNewCardsValidation);
      await expect(save).toBeDisabled();
      await expectScreenshot(`flashcards-invalid-${index}`, {
        target: dialog,
        ready: () => expect(limit).toHaveAttribute('aria-invalid', 'true')
      });
    }

    await expectAccessibility('flashcards-invalid');

    for (const value of ['0', '10000', '35']) {
      await limit.fill(value);
      await expect(limit).toHaveAttribute('aria-invalid', 'false');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await expect(save).toBeEnabled();
      await expectScreenshot(`flashcards-draft-${value}`, {
        target: dialog,
        ready: () => expect(save).toBeEnabled()
      });
      await limit.press('Enter');
      await expect(save).toBeDisabled();
      await expect(limit).toBeEnabled();
      await expectScreenshot(`flashcards-saved-${value}`, {
        target: dialog,
        ready: () => expect(save).toBeDisabled()
      });
    }

    await limit.fill('99');
    await expect(save).toBeEnabled();
    await expectScreenshot('flashcards-unsaved', {
      target: dialog,
      ready: () => expect(limit).toHaveValue('99')
    });
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.Flashcards, exact: true }).click();
    await expect(limit).toHaveValue('35');
    await expectScreenshot('flashcards-discarded', {
      target: dialog,
      ready: () => expect(limit).toHaveValue('35')
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.Flashcards, exact: true }).click();
    await expect(limit).toHaveValue('35');
    await expect(save).toBeDisabled();
    await expectAccessibility('flashcards-reloaded');
    await expectScreenshot('flashcards-reloaded', {
      target: dialog,
      ready: () => expect(limit).toHaveValue('35')
    });
    await limit.fill('20');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(limit).toBeEnabled();
    await expectScreenshot('flashcards-restored', {
      target: dialog,
      ready: () => expect(limit).toHaveValue('20')
    });
  }
);

testE2e(
  'Performance settings validate and persist independent concurrency limits',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.SettingsPerformance, exact: true }).click();
    const rows = [
      {
        name: copy.PerformanceSettingsParallel,
        initial: '2',
        invalid: ['', '0', '9', '1.5'],
        valid: ['1', '8', '3'],
        error: copy.PerformanceSettingsParallelValidation
      },
      {
        name: copy.PerformanceSettingsQueue,
        initial: '16',
        invalid: ['', '-1', '65', '2.5'],
        valid: ['0', '64', '9'],
        error: copy.PerformanceSettingsQueueValidation
      }
    ];

    await expectScreenshot('performance-defaults', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('spinbutton', { name: copy.PerformanceSettingsParallel, exact: true })
        ).toHaveValue('2')
    });

    for (const [rowIndex, row] of rows.entries()) {
      const input = dialog.getByRole('spinbutton', { name: row.name, exact: true });
      const save = input
        .locator('xpath=ancestor::form')
        .getByRole('button', { name: copy.Save, exact: true });

      await expect(input).toHaveValue(row.initial);
      await expect(save).toBeDisabled();

      for (const [index, invalid] of row.invalid.entries()) {
        await input.fill(invalid);
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await expect(dialog.getByRole('alert')).toHaveText(row.error);
        await expect(save).toBeDisabled();
        await expectScreenshot(`performance-${rowIndex}-invalid-${index}`, {
          target: dialog,
          ready: () => expect(input).toHaveAttribute('aria-invalid', 'true')
        });
      }

      for (const value of row.valid) {
        await input.fill(value);
        await expect(input).toHaveAttribute('aria-invalid', 'false');
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(save).toBeEnabled();
        await expectScreenshot(`performance-${rowIndex}-draft-${value}`, {
          target: dialog,
          ready: () => expect(save).toBeEnabled()
        });
        await input.press('Enter');
        await expect(save).toBeDisabled();
        await expect(input).toBeEnabled();
        await expectScreenshot(`performance-${rowIndex}-saved-${value}`, {
          target: dialog,
          ready: () => expect(save).toBeDisabled()
        });
      }
    }

    await expectAccessibility('performance-saved');
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.SettingsPerformance, exact: true }).click();
    await expect(
      dialog.getByRole('spinbutton', { name: copy.PerformanceSettingsParallel, exact: true })
    ).toHaveValue('3');
    await expect(
      dialog.getByRole('spinbutton', { name: copy.PerformanceSettingsQueue, exact: true })
    ).toHaveValue('9');
    await expectScreenshot('performance-reloaded', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('spinbutton', { name: copy.PerformanceSettingsQueue, exact: true })
        ).toHaveValue('9')
    });

    for (const [index, row] of rows.entries()) {
      const input = dialog.getByRole('spinbutton', { name: row.name, exact: true });
      const save = input
        .locator('xpath=ancestor::form')
        .getByRole('button', { name: copy.Save, exact: true });

      await input.fill(row.initial);
      await save.click();
      await expect(save).toBeDisabled();
      await expect(input).toBeEnabled();
      await expectScreenshot(`performance-restored-${index}`, {
        target: dialog,
        ready: () => expect(input).toHaveValue(row.initial)
      });
    }
  }
);

testE2e(
  'Custom instructions validate save and reset every task draft',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.AgentRulesTitle, exact: true }).click();
    const task = dialog.getByRole('combobox', { name: copy.AgentRulesTask, exact: true });
    const save = dialog.getByRole('button', { name: copy.Save, exact: true });
    const useDefault = dialog.getByRole('button', { name: copy.AgentRulesUseDefault, exact: true });
    const tasks = [
      copy.AgentRulesPages,
      copy.AgentRulesTitles,
      copy.AgentRulesReplies,
      copy.AgentRulesQuizzes,
      copy.AgentRulesFlashcards,
      copy.AgentRulesGrading,
      copy.AgentRulesTranscription,
      copy.AgentRulesQuestionDetection
    ];
    const pages = dialog.getByRole('textbox', { name: copy.AgentRulesPages, exact: true });

    await expect(pages).toHaveValue('');
    await expect(save).toBeDisabled();
    await expect(useDefault).toBeDisabled();
    await expectScreenshot('instructions-default', {
      target: dialog,
      ready: () => expect(pages).toHaveValue('')
    });
    await task.click();
    await expect(page.getByRole('option')).toHaveCount(8);
    await expectScreenshot('instructions-task-options', {
      target: dialog,
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.AgentRulesQuestionDetection, exact: true })
        ).toBeVisible()
    });
    await task.press('Escape');
    await pages.fill('Unsaved instruction that must be discarded.');
    await expect(save).toBeEnabled();
    await expectScreenshot('instructions-unsaved', {
      target: dialog,
      ready: () => expect(save).toBeEnabled()
    });
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.AgentRulesTitle, exact: true }).click();
    await expect(pages).toHaveValue('');
    await expectScreenshot('instructions-discarded', {
      target: dialog,
      ready: () => expect(pages).toHaveValue('')
    });
    await expect(pages).toHaveAttribute('maxlength', String(maxAgentRuleLength));
    await pages.fill('x'.repeat(maxAgentRuleLength + 1));
    await expect(pages).toHaveValue('x'.repeat(maxAgentRuleLength));
    await pages.press('End');
    await pages.press('y');
    await expect(pages).toHaveValue('x'.repeat(maxAgentRuleLength));
    await expectScreenshot('instructions-max-length', {
      target: dialog,
      ready: () => expect(pages).toHaveValue('x'.repeat(maxAgentRuleLength))
    });

    for (const [index, title] of tasks.entries()) {
      await task.click();
      await page.getByRole('option', { name: title, exact: true }).click();
      const editor = dialog.getByRole('textbox', { name: title, exact: true });

      await editor.fill(
        `Prefer concise examples for ${title}.\nKeep this task-specific instruction ${index}.`
      );
      await expect(save).toBeEnabled();
      await expect(useDefault).toBeEnabled();
      await expectScreenshot(`instructions-draft-${index}`, {
        target: dialog,
        ready: () =>
          expect(editor).toHaveValue(
            `Prefer concise examples for ${title}.\nKeep this task-specific instruction ${index}.`
          )
      });
    }

    await task.click();
    await page.getByRole('option', { name: copy.AgentRulesPages, exact: true }).click();
    await expect(pages).toHaveValue(
      `Prefer concise examples for ${copy.AgentRulesPages}.\nKeep this task-specific instruction 0.`
    );
    await save.click();
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText(copy.AgentRulesSaved);
    await expectScreenshot('instructions-saved', {
      target: dialog,
      ready: () => expect(dialog.getByRole('status')).toHaveText(copy.AgentRulesSaved)
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.AgentRulesTitle, exact: true }).click();

    for (const [index, title] of tasks.entries()) {
      await task.click();
      await page.getByRole('option', { name: title, exact: true }).click();
      const editor = dialog.getByRole('textbox', { name: title, exact: true });

      await expect(editor).toHaveValue(
        `Prefer concise examples for ${title}.\nKeep this task-specific instruction ${index}.`
      );

      if (index === 0) await expect(save).toBeDisabled();
      else await expect(save).toBeEnabled();

      await expectScreenshot(`instructions-reloaded-${index}`, {
        target: dialog,
        ready: () =>
          expect(editor).toHaveValue(
            `Prefer concise examples for ${title}.\nKeep this task-specific instruction ${index}.`
          )
      });
      await useDefault.click();
      await expect(editor).toHaveValue('');
      await expect(useDefault).toBeDisabled();
      await expect(save).toBeEnabled();
      await expectScreenshot(`instructions-default-draft-${index}`, {
        target: dialog,
        ready: () => expect(editor).toHaveValue('')
      });
    }

    await save.click();
    await expect(dialog.getByRole('status')).toHaveText(copy.AgentRulesSaved);
    await expect(save).toBeDisabled();
    await expectAccessibility('instructions-restored');
    await expectScreenshot('instructions-defaults-saved', {
      target: dialog,
      ready: () => expect(dialog.getByRole('status')).toHaveText(copy.AgentRulesSaved)
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.AgentRulesTitle, exact: true }).click();

    for (const [index, title] of tasks.entries()) {
      await task.click();
      await page.getByRole('option', { name: title, exact: true }).click();
      const editor = dialog.getByRole('textbox', { name: title, exact: true });

      await expect(editor).toHaveValue('');
      await expect(useDefault).toBeDisabled();
      await expect(save).toBeDisabled();
      await expectScreenshot(`instructions-default-reloaded-${index}`, {
        target: dialog,
        ready: () => expect(editor).toHaveValue('')
      });
    }
  }
);

testE2e(
  'Quiz settings persist every generation and shuffle option',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    const count = dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true });
    const kind = dialog.getByRole('combobox', { name: copy.QuizQuestionKind, exact: true });
    const choices = dialog.getByRole('combobox', { name: copy.QuizGenerateChoices, exact: true });
    const difficulty = dialog.getByRole('combobox', { name: copy.QuizDifficulty, exact: true });
    const shuffleQuestions = dialog.getByRole('switch', {
      name: copy.QuizShuffleQuestions,
      exact: true
    });
    const shuffleChoices = dialog.getByRole('switch', {
      name: copy.QuizShuffleChoices,
      exact: true
    });

    await expect(count).toHaveText('10');
    await expect(kind).toHaveText(copy.QuizKindAll);
    await expect(choices).toHaveText('4');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expect(shuffleQuestions).not.toBeChecked();
    await expect(shuffleChoices).toBeChecked();
    await expectScreenshot('quiz-defaults', {
      target: dialog,
      ready: () => expect(count).toBeEnabled()
    });
    const selects = [
      { control: count, values: ['1', '7', '10', '6'] },
      {
        control: kind,
        values: [
          copy.QuestionChoice,
          copy.QuestionOpen,
          copy.PracticeFillBlank,
          copy.PracticeOrdering,
          copy.PracticeMatching,
          copy.PracticeTrueFalse,
          copy.QuizKindAll
        ]
      },
      { control: choices, values: ['2', '3', '5', '6', '4'] },
      {
        control: difficulty,
        values: [
          copy.QuizDifficultyEasy,
          copy.QuizDifficultyChallenging,
          copy.QuizDifficultyBalanced
        ]
      }
    ];

    for (const [controlIndex, selection] of selects.entries()) {
      await selection.control.click();
      await expect(page.getByRole('listbox')).toBeVisible();
      await expectScreenshot(`quiz-options-${controlIndex}`, {
        target: dialog,
        ready: () => expect(page.getByRole('listbox')).toBeVisible()
      });
      await selection.control.press('Escape');

      for (const [index, value] of selection.values.entries()) {
        await selection.control.click();
        await page.getByRole('option', { name: value, exact: true }).click();
        await expect(selection.control).toHaveText(value);
        await expect(selection.control).toBeEnabled();
        await expectScreenshot(`quiz-selection-${controlIndex}-${index}`, {
          target: dialog,
          ready: () => expect(selection.control).toBeEnabled()
        });
      }
    }

    for (const [index, toggle] of [shuffleQuestions, shuffleChoices].entries()) {
      const initiallyChecked = index === 1;

      for (const [transition, checked] of [
        !initiallyChecked,
        initiallyChecked,
        !initiallyChecked
      ].entries()) {
        await toggle.press('Space');
        await expect(toggle).toBeChecked({ checked });
        await expect(toggle).toBeEnabled();
        await expectScreenshot(`quiz-toggle-${index}-${transition}`, {
          target: dialog,
          ready: () => expect(toggle).toBeChecked({ checked })
        });
      }
    }

    await expectAccessibility('quiz-saved');
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await expect(count).toHaveText('6');
    await expect(kind).toHaveText(copy.QuizKindAll);
    await expect(choices).toHaveText('4');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expect(shuffleQuestions).toBeChecked();
    await expect(shuffleChoices).not.toBeChecked();
    await expectScreenshot('quiz-reloaded', {
      target: dialog,
      ready: () => expect(shuffleChoices).not.toBeChecked()
    });
    await count.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(count).toBeEnabled();
    await expectScreenshot('quiz-count-restored', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await shuffleQuestions.click();
    await expect(shuffleQuestions).not.toBeChecked();
    await expect(shuffleQuestions).toBeEnabled();
    await expectScreenshot('quiz-question-order-restored', {
      target: dialog,
      ready: () => expect(shuffleQuestions).not.toBeChecked()
    });
    await shuffleChoices.click();
    await expect(shuffleChoices).toBeChecked();
    await expect(shuffleChoices).toBeEnabled();
    await expectScreenshot('quiz-choice-order-restored', {
      target: dialog,
      ready: () => expect(shuffleChoices).toBeChecked()
    });
  }
);

testE2e(
  'Fill blank settings persist independent generation preferences',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.PracticeFillBlank, exact: true }).click();
    const count = dialog.getByRole('combobox', {
      name: copy.PracticeSettingsQuestionCount,
      exact: true
    });
    const difficulty = dialog.getByRole('combobox', { name: copy.QuizDifficulty, exact: true });

    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expect(dialog.getByRole('combobox')).toHaveCount(2);
    await expect(dialog.getByRole('switch')).toHaveCount(0);
    await expectScreenshot('fill-blank-defaults', {
      target: dialog,
      ready: () => expect(count).toBeEnabled()
    });
    await count.click();
    await expect(page.getByRole('option')).toHaveCount(10);
    await expectScreenshot('fill-blank-count-options', {
      target: dialog,
      ready: () => expect(page.getByRole('option', { name: '1', exact: true })).toBeVisible()
    });
    await count.press('Escape');

    for (const value of ['1', '10', '2']) {
      await count.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(count).toHaveText(value);
      await expect(count).toBeEnabled();
      await expectScreenshot(`fill-blank-count-${value}`, {
        target: dialog,
        ready: () => expect(count).toBeEnabled()
      });
    }

    await difficulty.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expectScreenshot('fill-blank-difficulty-options', {
      target: dialog,
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.QuizDifficultyEasy, exact: true })
        ).toBeVisible()
    });
    await difficulty.press('Escape');

    for (const [index, value] of [
      copy.QuizDifficultyEasy,
      copy.QuizDifficultyBalanced,
      copy.QuizDifficultyChallenging
    ].entries()) {
      await difficulty.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(difficulty).toHaveText(value);
      await expect(difficulty).toBeEnabled();
      await expectScreenshot(`fill-blank-difficulty-${index}`, {
        target: dialog,
        ready: () => expect(difficulty).toBeEnabled()
      });
    }

    await expectAccessibility('fill-blank-saved');
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeFillBlank, exact: true }).click();
    await expect(count).toHaveText('2');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('fill-blank-reopened', {
      target: dialog,
      ready: () => expect(count).toHaveText('2')
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeFillBlank, exact: true }).click();
    await expect(count).toHaveText('2');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('fill-blank-reloaded', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyChallenging)
    });
    await navigation.getByRole('button', { name: copy.PracticeOrdering, exact: true }).click();
    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('fill-blank-other-mode-unchanged', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
    ).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('fill-blank-quiz-unchanged', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
        ).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.PracticeFillBlank, exact: true }).click();
    await count.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(count).toBeEnabled();
    await expectScreenshot('fill-blank-count-restored', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await difficulty.click();
    await page.getByRole('option', { name: copy.QuizDifficultyBalanced, exact: true }).click();
    await expect(difficulty).toBeEnabled();
    await expectScreenshot('fill-blank-difficulty-restored', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyBalanced)
    });
  }
);

testE2e(
  'Ordering settings customize generation independently and survive reload',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.PracticeOrdering, exact: true }).click();
    const count = dialog.getByRole('combobox', {
      name: copy.PracticeSettingsQuestionCount,
      exact: true
    });
    const difficulty = dialog.getByRole('combobox', { name: copy.QuizDifficulty, exact: true });

    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expect(dialog.getByRole('combobox')).toHaveCount(2);
    await expect(dialog.getByRole('switch')).toHaveCount(0);
    await expectScreenshot('ordering-defaults', {
      target: dialog,
      ready: () => expect(count).toBeEnabled()
    });
    await count.click();
    await expect(page.getByRole('option')).toHaveCount(10);
    await expectScreenshot('ordering-count-options', {
      target: dialog,
      ready: () => expect(page.getByRole('option', { name: '1', exact: true })).toBeVisible()
    });
    await count.press('Escape');

    for (const value of ['1', '10', '3']) {
      await count.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(count).toHaveText(value);
      await expect(count).toBeEnabled();
      await expectScreenshot(`ordering-count-${value}`, {
        target: dialog,
        ready: () => expect(count).toBeEnabled()
      });
    }

    await difficulty.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expectScreenshot('ordering-difficulty-options', {
      target: dialog,
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.QuizDifficultyEasy, exact: true })
        ).toBeVisible()
    });
    await difficulty.press('Escape');

    for (const [index, value] of [
      copy.QuizDifficultyEasy,
      copy.QuizDifficultyBalanced,
      copy.QuizDifficultyChallenging
    ].entries()) {
      await difficulty.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(difficulty).toHaveText(value);
      await expect(difficulty).toBeEnabled();
      await expectScreenshot(`ordering-difficulty-${index}`, {
        target: dialog,
        ready: () => expect(difficulty).toBeEnabled()
      });
    }

    await expectAccessibility('ordering-saved');
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeOrdering, exact: true }).click();
    await expect(count).toHaveText('3');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('ordering-reopened', {
      target: dialog,
      ready: () => expect(count).toHaveText('3')
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeOrdering, exact: true }).click();
    await expect(count).toHaveText('3');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('ordering-reloaded', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyChallenging)
    });
    await navigation.getByRole('button', { name: copy.PracticeMatching, exact: true }).click();
    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('ordering-other-mode-unchanged', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
    ).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('ordering-quiz-unchanged', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
        ).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.PracticeOrdering, exact: true }).click();
    await count.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(count).toBeEnabled();
    await expectScreenshot('ordering-count-restored', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await difficulty.click();
    await page.getByRole('option', { name: copy.QuizDifficultyBalanced, exact: true }).click();
    await expect(difficulty).toBeEnabled();
    await expectScreenshot('ordering-difficulty-restored', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyBalanced)
    });
  }
);

testE2e(
  'Matching settings customize generation independently and survive reload',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.PracticeMatching, exact: true }).click();
    const count = dialog.getByRole('combobox', {
      name: copy.PracticeSettingsQuestionCount,
      exact: true
    });
    const difficulty = dialog.getByRole('combobox', { name: copy.QuizDifficulty, exact: true });

    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expect(dialog.getByRole('combobox')).toHaveCount(2);
    await expect(dialog.getByRole('switch')).toHaveCount(0);
    await expectScreenshot('matching-defaults', {
      target: dialog,
      ready: () => expect(count).toBeEnabled()
    });
    await count.click();
    await expect(page.getByRole('option')).toHaveCount(10);
    await expectScreenshot('matching-count-options', {
      target: dialog,
      ready: () => expect(page.getByRole('option', { name: '1', exact: true })).toBeVisible()
    });
    await count.press('Escape');

    for (const value of ['1', '10', '4']) {
      await count.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(count).toHaveText(value);
      await expect(count).toBeEnabled();
      await expectScreenshot(`matching-count-${value}`, {
        target: dialog,
        ready: () => expect(count).toBeEnabled()
      });
    }

    await difficulty.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expectScreenshot('matching-difficulty-options', {
      target: dialog,
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.QuizDifficultyEasy, exact: true })
        ).toBeVisible()
    });
    await difficulty.press('Escape');

    for (const [index, value] of [
      copy.QuizDifficultyEasy,
      copy.QuizDifficultyBalanced,
      copy.QuizDifficultyChallenging
    ].entries()) {
      await difficulty.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(difficulty).toHaveText(value);
      await expect(difficulty).toBeEnabled();
      await expectScreenshot(`matching-difficulty-${index}`, {
        target: dialog,
        ready: () => expect(difficulty).toBeEnabled()
      });
    }

    await expectAccessibility('matching-saved');
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeMatching, exact: true }).click();
    await expect(count).toHaveText('4');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('matching-reopened', {
      target: dialog,
      ready: () => expect(count).toHaveText('4')
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeMatching, exact: true }).click();
    await expect(count).toHaveText('4');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('matching-reloaded', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyChallenging)
    });
    await navigation.getByRole('button', { name: copy.PracticeTrueFalse, exact: true }).click();
    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('matching-other-mode-unchanged', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
    ).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('matching-quiz-unchanged', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
        ).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.PracticeMatching, exact: true }).click();
    await count.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(count).toBeEnabled();
    await expectScreenshot('matching-count-restored', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await difficulty.click();
    await page.getByRole('option', { name: copy.QuizDifficultyBalanced, exact: true }).click();
    await expect(difficulty).toBeEnabled();
    await expectScreenshot('matching-difficulty-restored', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyBalanced)
    });
  }
);

testE2e(
  'True or false settings customize generation independently and survive reload',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation', { name: copy.Settings });

    await navigation.getByRole('button', { name: copy.PracticeTrueFalse, exact: true }).click();
    const count = dialog.getByRole('combobox', {
      name: copy.PracticeSettingsQuestionCount,
      exact: true
    });
    const difficulty = dialog.getByRole('combobox', { name: copy.QuizDifficulty, exact: true });

    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expect(dialog.getByRole('combobox')).toHaveCount(2);
    await expect(dialog.getByRole('switch')).toHaveCount(0);
    await expectScreenshot('true-false-defaults', {
      target: dialog,
      ready: () => expect(count).toBeEnabled()
    });
    await count.click();
    await expect(page.getByRole('option')).toHaveCount(10);
    await expectScreenshot('true-false-count-options', {
      target: dialog,
      ready: () => expect(page.getByRole('option', { name: '1', exact: true })).toBeVisible()
    });
    await count.press('Escape');

    for (const value of ['1', '10', '5']) {
      await count.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(count).toHaveText(value);
      await expect(count).toBeEnabled();
      await expectScreenshot(`true-false-count-${value}`, {
        target: dialog,
        ready: () => expect(count).toBeEnabled()
      });
    }

    await difficulty.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expectScreenshot('true-false-difficulty-options', {
      target: dialog,
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.QuizDifficultyEasy, exact: true })
        ).toBeVisible()
    });
    await difficulty.press('Escape');

    for (const [index, value] of [
      copy.QuizDifficultyEasy,
      copy.QuizDifficultyBalanced,
      copy.QuizDifficultyChallenging
    ].entries()) {
      await difficulty.click();
      await page.getByRole('option', { name: value, exact: true }).click();
      await expect(difficulty).toHaveText(value);
      await expect(difficulty).toBeEnabled();
      await expectScreenshot(`true-false-difficulty-${index}`, {
        target: dialog,
        ready: () => expect(difficulty).toBeEnabled()
      });
    }

    await expectAccessibility('true-false-saved');
    await dialog.getByRole('button', { name: copy.Close }).click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeTrueFalse, exact: true }).click();
    await expect(count).toHaveText('5');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('true-false-reopened', {
      target: dialog,
      ready: () => expect(count).toHaveText('5')
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.PracticeTrueFalse, exact: true }).click();
    await expect(count).toHaveText('5');
    await expect(difficulty).toHaveText(copy.QuizDifficultyChallenging);
    await expectScreenshot('true-false-reloaded', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyChallenging)
    });
    await navigation.getByRole('button', { name: copy.PracticeFillBlank, exact: true }).click();
    await expect(count).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('true-false-other-mode-unchanged', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
    ).toHaveText('10');
    await expect(difficulty).toHaveText(copy.QuizDifficultyBalanced);
    await expectScreenshot('true-false-quiz-unchanged', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('combobox', { name: copy.QuizQuestionCount, exact: true })
        ).toHaveText('10')
    });
    await navigation.getByRole('button', { name: copy.PracticeTrueFalse, exact: true }).click();
    await count.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(count).toBeEnabled();
    await expectScreenshot('true-false-count-restored', {
      target: dialog,
      ready: () => expect(count).toHaveText('10')
    });
    await difficulty.click();
    await page.getByRole('option', { name: copy.QuizDifficultyBalanced, exact: true }).click();
    await expect(difficulty).toBeEnabled();
    await expectScreenshot('true-false-difficulty-restored', {
      target: dialog,
      ready: () => expect(difficulty).toHaveText(copy.QuizDifficultyBalanced)
    });
  }
);

testE2e(
  'General settings persist both languages and dismiss a replayed welcome',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.GeneralSettingsTitle, exact: true })
      .click();
    const language = dialog.getByRole('combobox', { name: copy.GeneralSettingsLanguage });

    await expect(language).toHaveText(copy.EnglishOwnName);
    await expectScreenshot('general-english', {
      target: dialog,
      ready: () => expect(language).toBeEnabled()
    });
    await language.click();
    await expectScreenshot('language-options', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('option', { name: copy.ItalianOwnName, exact: true })).toBeVisible()
    });
    await page.getByRole('option', { name: copy.ItalianOwnName, exact: true }).click();
    const italian = catalogs.italian;
    const localized = page.getByRole('dialog', { name: italian.Settings });
    const italianLanguage = localized.getByRole('combobox', {
      name: italian.GeneralSettingsLanguage
    });

    await expect(italianLanguage).toHaveText(italian.ItalianOwnName);
    await expect(italianLanguage).toBeEnabled();
    await page.reload();
    await page.getByRole('button', { name: italian.Settings, exact: true }).click();
    await localized
      .getByRole('navigation')
      .getByRole('button', { name: italian.GeneralSettingsTitle, exact: true })
      .click();
    await expectScreenshot('general-italian-reloaded', {
      target: localized,
      ready: () => expect(italianLanguage).toHaveText(italian.ItalianOwnName)
    });
    await expectAccessibility('general-italian');
    await italianLanguage.click();
    await page.getByRole('option', { name: italian.EnglishOwnName, exact: true }).click();
    await expect(language).toHaveText(copy.EnglishOwnName);
    await expect(language).toBeEnabled();
    await dialog.getByRole('button', { name: copy.ReplayOnboarding, exact: true }).click();
    const welcome = page.getByRole('dialog', { name: copy.OnboardingWelcomeTitle, exact: true });

    await expectScreenshot('replayed-welcome', {
      target: welcome,
      ready: () => expect(welcome).toBeVisible()
    });
    await welcome.getByRole('button', { name: copy.OnboardingStart, exact: true }).click();
    const replayLanguage = page.getByRole('dialog', {
      name: copy.GeneralSettingsLanguage,
      exact: true
    });

    await expect(
      replayLanguage.getByRole('combobox', { name: copy.GeneralSettingsLanguage })
    ).toHaveText(copy.EnglishOwnName);
    await replayLanguage.getByRole('button', { name: copy.Back, exact: true }).click();
    await welcome.getByRole('button', { name: copy.OnboardingSkip, exact: true }).click();
    await expect(welcome).toBeHidden();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: copy.Close, exact: true }).click();
    await page.reload();
    await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
);

testE2e(
  'Account settings expose sign in and keep provider credential drafts local',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.AiSettingsAccount, exact: true })
      .click();
    const provider = dialog.getByRole('combobox', { name: copy.AiSettingsProvider, exact: true });

    await expect(provider).toHaveText(copy.AiSettingsChatGpt);
    await expect(
      dialog.getByRole('button', { name: copy.AiSettingsSignIn, exact: true })
    ).toBeEnabled();
    await expectScreenshot('account-signed-out', {
      target: dialog,
      ready: () => expect(provider).toBeEnabled()
    });
    await provider.click();
    await expect(page.getByRole('option')).toHaveCount(11);
    const providers = await page.getByRole('option').allTextContents();

    await expectScreenshot('account-provider-options', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.AiSettingsChatGpt, exact: true })
        ).toBeVisible()
    });
    await page.getByRole('option', { name: copy.AiSettingsChatGpt, exact: true }).click();

    for (const name of providers.filter((name) => name !== copy.AiSettingsChatGpt)) {
      await provider.click();
      await page.getByRole('option', { name, exact: true }).click();
      const key = dialog.getByLabel(copy.AiSettingsApiKey, { exact: true });
      const save = dialog.getByRole('button', { name: copy.AiSettingsSaveKey, exact: true });

      await expect(key).toHaveValue('');
      await expect(save).toBeDisabled();
      await key.fill('   ');
      await expect(save).toBeDisabled();
      await expectScreenshot(`credential-invalid-${providers.indexOf(name)}`, {
        target: dialog,
        ready: () => expect(save).toBeDisabled()
      });
      await key.fill('unsaved-settings-credential-draft');
      await expect(save).toBeEnabled();
      await expect(key).toHaveAttribute('type', 'password');
      await expectScreenshot(`credential-draft-${providers.indexOf(name)}`, {
        target: dialog,
        ready: () => expect(save).toBeEnabled()
      });
    }

    await expectAccessibility('account-key-draft');
    await provider.click();
    await page.getByRole('option', { name: copy.AiSettingsChatGpt, exact: true }).click();
    await expect(dialog.getByLabel(copy.AiSettingsApiKey, { exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.AiSettingsAccount, exact: true })
      .click();
    await expect(provider).toHaveText(copy.AiSettingsChatGpt);
    await expect(
      dialog.getByRole('button', { name: copy.AiSettingsSignIn, exact: true })
    ).toBeEnabled();
  }
);

testE2e(
  'Models settings retain all tier selections while signed out',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation');

    await navigation.getByRole('button', { name: copy.AiSettingsModels, exact: true }).click();
    const tiers = [copy.AiSettingsTiny, copy.AiSettingsMedium, copy.AiSettingsSmart];
    const selections: string[] = [];

    for (const title of tiers) {
      const select = dialog.getByRole('combobox', { name: title, exact: true });

      await expect(select).toBeVisible();
      await expect(select).toBeDisabled();
      selections.push(await select.innerText());
    }

    await expectScreenshot('models-sign-in-required', {
      target: dialog,
      ready: () => expect(dialog.getByRole('combobox')).toHaveCount(3)
    });
    await expectAccessibility('models-signed-out');
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.AiSettingsModels, exact: true }).click();

    for (const [index, title] of tiers.entries()) {
      const select = dialog.getByRole('combobox', { name: title, exact: true });

      await expect(select).toHaveText(selections[index]!);
      await expect(select).toBeDisabled();
    }

    await expectScreenshot('models-reloaded', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('combobox', { name: copy.AiSettingsSmart, exact: true })
        ).toBeDisabled()
    });
  }
);

testE2e(
  'Usage settings filter and refresh real empty usage history',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.UsageTitle, exact: true })
      .click();
    const empty = dialog.getByText(copy.UsageEmpty, { exact: true });

    await expectScreenshot('usage-empty', {
      target: dialog,
      ready: () => expect(empty).toBeVisible()
    });
    const provider = dialog.getByRole('combobox', { name: copy.UsageProvider, exact: true });

    await provider.click();
    await expect(page.getByRole('option')).toHaveCount(1);
    await expectScreenshot('usage-provider-options', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('option', { name: copy.UsageAllProviders, exact: true })
        ).toBeVisible()
    });
    await page.getByRole('option', { name: copy.UsageAllProviders, exact: true }).click();

    for (const days of [1, 7, 90, 30]) {
      const label =
        days === 1 ? copy.UsagePastDay : copy.UsageDays.replace('{count}', String(days));
      const period = dialog.getByRole('button', { name: label, exact: true });

      await period.click();
      await expect(period).toHaveAttribute('aria-pressed', 'true');
      await expect(empty).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: copy.UsageRefresh, exact: true })
      ).toBeEnabled();
      await expectScreenshot(`usage-period-${days}`, {
        target: dialog,
        ready: () => expect(period).toHaveAttribute('aria-pressed', 'true')
      });
    }

    await dialog.getByRole('button', { name: copy.UsageRefresh, exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: copy.UsageRefresh, exact: true })
    ).toBeEnabled();
    await expect(empty).toBeVisible();
    await expect(dialog.getByRole('table')).toHaveCount(0);
    await expect(dialog.getByRole('group', { name: copy.UsageBreakdown, exact: true })).toHaveCount(
      0
    );
    await expectAccessibility('usage-empty-filtered');
  }
);

testE2e(
  'Analytics settings explain that diagnostic controls require the desktop',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.AnalyticsTitle, exact: true })
      .click();
    await expect(dialog.getByText(copy.AnalyticsDesktop, { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('searchbox', { name: copy.AnalyticsSearch, exact: true })
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('combobox', { name: copy.AnalyticsLevel, exact: true })
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: copy.AnalyticsRefresh, exact: true })
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: copy.AnalyticsExport, exact: true })
    ).toHaveCount(0);
    await expectAccessibility('analytics-browser-unavailable');
    await expectScreenshot('analytics-desktop-required', {
      target: dialog,
      ready: () => expect(dialog.getByText(copy.AnalyticsDesktop, { exact: true })).toBeVisible()
    });
  }
);

testE2e(
  'Updates settings explain browser limitations without offering native actions',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.Updates, exact: true })
      .click();
    await expect(dialog.getByText(copy.UpdateUnavailable, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: copy.UpdateCheck, exact: true })).toHaveCount(
      0
    );
    await expect(dialog.getByRole('button', { name: copy.UpdateInstall, exact: true })).toHaveCount(
      0
    );
    await expectAccessibility('updates-browser-unavailable');
    await expectScreenshot('updates-browser-unavailable', {
      target: dialog,
      ready: () => expect(dialog.getByText(copy.UpdateUnavailable, { exact: true })).toBeVisible()
    });
  }
);

testE2e(
  'Integrations settings preview, cancel and import a real vault with warnings',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.IntegrationsTitle, exact: true })
      .click();
    const name = dialog.getByRole('textbox', { name: copy.IntegrationVaultName, exact: true });
    const provider = dialog.getByRole('combobox', { name: copy.IntegrationProvider, exact: true });

    await expectScreenshot('integrations-empty-history', {
      target: dialog,
      ready: () =>
        expect(dialog.getByText(copy.IntegrationHistoryEmpty, { exact: true })).toBeVisible()
    });
    await provider.click();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: copy.IntegrationObsidian, exact: true }).click();
    await name.fill('x'.repeat(201));
    await expect(name).toHaveValue('x'.repeat(200));
    await expectScreenshot('vault-name-limit', {
      target: dialog,
      ready: () => expect(name).toHaveValue('x'.repeat(200))
    });
    await name.fill('Cancelled settings vault');
    const vaultPath = Bun.fileURLToPath(new URL('../fixtures/settings-vault', import.meta.url));
    const picker = dialog.getByLabel(copy.IntegrationChooseVault, { exact: true });

    await picker.setInputFiles(vaultPath);
    const switches = dialog.getByRole('switch');

    await expect(switches).toHaveCount(2);
    await expect(switches.nth(0)).toBeChecked();
    await expect(switches.nth(1)).toBeChecked();
    const destination = dialog.getByRole('combobox', {
      name: copy.IntegrationDestination,
      exact: true
    });

    await expect(destination).toHaveText(copy.IntegrationNoProject);
    await destination.click();
    await page.getByRole('option', { name: copy.IntegrationNoProject, exact: true }).click();
    const warnings = dialog.locator('summary');

    await warnings.click();
    await expect(
      dialog.getByRole('heading', { name: copy.IntegrationEmptyNote, exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: copy.IntegrationMissingLink, exact: true })
    ).toBeVisible();
    await expectScreenshot('vault-preview-warnings', {
      target: dialog,
      ready: () => expect(switches).toHaveCount(2)
    });
    await warnings.click();
    await switches.nth(0).click();
    await switches.nth(1).click();
    const importNone = dialog.getByRole('button', {
      name: copy.IntegrationStart.replace('{count}', '0'),
      exact: true
    });

    await expect(importNone).toBeDisabled();
    await expectScreenshot('vault-no-notes-selected', {
      target: dialog,
      ready: () => expect(importNone).toBeDisabled()
    });
    await dialog.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(dialog.getByText(copy.IntegrationCancelled, { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: copy.IntegrationResume, exact: true })
    ).toHaveCount(0);
    await expectScreenshot('vault-preview-cancelled', {
      target: dialog,
      ready: () =>
        expect(dialog.getByText(copy.IntegrationCancelled, { exact: true })).toBeVisible()
    });
    await name.fill('Imported settings vault');
    await picker.setInputFiles(vaultPath);
    await expect(switches).toHaveCount(2);
    await switches.nth(1).click();
    const importOne = dialog.getByRole('button', {
      name: copy.IntegrationStart.replace('{count}', '1'),
      exact: true
    });

    await expect(importOne).toBeEnabled();
    await expectScreenshot('vault-one-note-selected', {
      target: dialog,
      ready: () => expect(importOne).toBeEnabled()
    });
    await importOne.click();
    await expect(dialog.getByText(copy.IntegrationCompleted, { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole('link', { name: copy.IntegrationOpenNote, exact: true })
    ).toHaveCount(1);
    await expectAccessibility('integrations-completed');
    await expectScreenshot('vault-import-completed', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('link', { name: copy.IntegrationOpenNote, exact: true })
        ).toBeVisible()
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.IntegrationsTitle, exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Imported settings vault', exact: true }).click();
    await expect(
      dialog.getByRole('link', { name: copy.IntegrationOpenNote, exact: true })
    ).toHaveCount(1);
    await expectScreenshot('vault-history-reopened', {
      target: dialog,
      ready: () =>
        expect(dialog.getByText(copy.IntegrationCompleted, { exact: true })).toBeVisible()
    });
    await dialog.getByRole('link', { name: copy.IntegrationOpenNote, exact: true }).click();
    await expect(page).toHaveURL(/\/notes\/[^/]+$/);
  }
);

const reviewTheme = {
  version: 1,
  id: 'settings-review',
  name: 'Settings review',
  colors: {},
  light: {},
  dark: {}
};

testE2e(
  'Appearance settings capture schemes sliders and the custom theme lifecycle',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation');

    await expect(dialog.getByRole('slider', { name: copy.TextSize, exact: true })).toBeEnabled();
    await expectScreenshot('appearance-initial', {
      target: dialog,
      ready: () => expect(dialog.getByRole('radio', { name: copy.Dark, exact: true })).toBeChecked()
    });

    for (const [index, mode] of [copy.Light, copy.SystemAppearance, copy.Dark].entries()) {
      const choice = dialog.getByRole('radio', { name: mode, exact: true });

      await choice.click();
      await expect(choice).toBeChecked();
      await expect(choice).toBeEnabled();
      await expectScreenshot(`scheme-${index}`, {
        target: dialog,
        ready: () => expect(choice).toBeChecked()
      });
    }

    for (const [index, label] of [
      copy.AppearanceContrast,
      copy.GlassOpacity,
      copy.PanelAnimations
    ].entries()) {
      const slider = dialog.getByRole('slider', { name: label, exact: true });
      const original = await slider.inputValue();

      await slider.press('End');
      await expect(slider).toBeEnabled();
      await expectScreenshot(`slider-${index}-maximum`, {
        target: dialog,
        center: slider,
        ready: () => expect(slider).toHaveValue(index === 0 ? '150' : index === 1 ? '100' : '400')
      });
      await slider.press('Home');
      await expect(slider).toBeEnabled();
      await expectScreenshot(`slider-${index}-minimum`, {
        target: dialog,
        center: slider,
        ready: () => expect(slider).toHaveValue(index === 0 ? '75' : index === 1 ? '40' : '0')
      });
      await dialog
        .getByRole('button', { name: `${copy.ResetSetting}: ${label}`, exact: true })
        .click();
      await expect(slider).toHaveValue(original);
      await expect(slider).toBeEnabled();
      await expectScreenshot(`slider-${index}-reset`, {
        target: dialog,
        center: slider,
        ready: () => expect(slider).toHaveValue(original)
      });
    }

    const zoom = dialog.getByRole('slider', { name: copy.TextSize, exact: true });

    for (const [key, value] of [
      ['End', 200],
      ['Home', 50]
    ] as const) {
      await zoom.press(key);
      await expect(zoom).toHaveValue(String(value));
      await expect(zoom).toBeEnabled();
      await expectScreenshot(`zoom-boundary-${value}`, {
        target: dialog,
        zoomPercent: value,
        center: zoom,
        ready: () => expect(zoom).toHaveValue(String(value))
      });
    }

    await dialog
      .getByRole('button', { name: `${copy.ResetSetting}: ${copy.TextSize}`, exact: true })
      .click();
    await expect(zoom).toHaveValue('100');
    await expect(zoom).toBeEnabled();
    await expectScreenshot('zoom-reset', {
      target: dialog,
      zoomPercent: 100,
      center: zoom,
      ready: () => expect(zoom).toHaveValue('100')
    });

    for (let value = 105; value <= 130; value += 5) {
      await zoom.press('ArrowRight');
      await expect(zoom).toHaveValue(String(value));
      await expect(zoom).toBeEnabled();
    }

    await expect(zoom).toHaveValue('130');
    await expect(zoom).toBeEnabled();
    await expectScreenshot('zoom-changed', {
      target: dialog,
      zoomPercent: 130,
      center: zoom,
      ready: () => expect(zoom).toHaveValue('130')
    });
    await zoom.press('ArrowLeft');
    await expect(zoom).toHaveValue('125');
    await expect(zoom).toBeEnabled();
    await navigation.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await navigation.getByRole('button', { name: copy.Appearance, exact: true }).click();

    const themes = dialog.locator('.settings-theme-select');

    await expect(themes).toHaveCount(9);
    const names = await themes.allTextContents();

    for (const [index, raw] of names.entries()) {
      const name = raw.trim();
      const theme = dialog.getByRole('button', { name, exact: true });

      await theme.click();
      await expect(theme).toHaveAttribute('aria-pressed', 'true');
      await expect(theme).toBeEnabled();
      await expectScreenshot(`theme-${index}`, {
        target: dialog,
        ready: () => expect(theme).toHaveAttribute('aria-pressed', 'true')
      });
    }

    // Return to the canonical palette before capturing editors and validation.
    await dialog.getByRole('button', { name: names[0]!.trim(), exact: true }).click();
    await expect(dialog.getByRole('button', { name: names[0]!.trim(), exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: copy.AddTheme, exact: true }).click();
    const importer = page.getByRole('dialog', { name: copy.AddTheme, exact: true });
    const json = importer.getByRole('textbox', { name: copy.ThemeJson });
    const save = importer.getByRole('button', { name: copy.Save, exact: true });

    await expect(save).toBeDisabled();
    await expectScreenshot('theme-import-empty', {
      target: importer,
      ready: () => expect(save).toBeDisabled()
    });

    for (const [index, value] of [
      '{invalid json',
      JSON.stringify({ ...reviewTheme, version: 2 }),
      JSON.stringify({ ...reviewTheme, name: '' }),
      JSON.stringify({ ...reviewTheme, colors: { foreground: 'not-a-color' } })
    ].entries()) {
      await json.fill(value);
      await save.click();
      await expect(importer.getByRole('alert')).toHaveText(copy.ThemeImportFailed);
      await expect(json).toHaveAttribute('aria-invalid', 'true');
      await expectScreenshot(`theme-import-invalid-${index}`, {
        target: importer,
        ready: () => expect(importer.getByRole('alert')).toHaveText(copy.ThemeImportFailed)
      });
    }

    await importer.getByLabel(copy.ChooseThemeFile, { exact: true }).setInputFiles({
      name: 'oversize.json',
      mimeType: 'application/json',
      buffer: Buffer.from(' '.repeat(65537))
    });
    await expect(importer.getByRole('alert')).toHaveText(copy.ThemeImportFailed);
    await expectScreenshot('theme-file-too-large', {
      target: importer,
      ready: () => expect(importer.getByRole('alert')).toBeVisible()
    });
    const importedTheme = { ...reviewTheme, id: 'settings-imported', name: 'Settings imported' };

    await importer.getByLabel(copy.ChooseThemeFile, { exact: true }).setInputFiles({
      name: 'settings-theme.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(importedTheme))
    });
    await expect(json).toHaveValue(JSON.stringify(importedTheme));
    await expect(importer.getByRole('alert')).toHaveCount(0);
    await expectScreenshot('theme-file-valid', {
      target: importer,
      ready: () => expect(json).toHaveValue(JSON.stringify(importedTheme))
    });
    await save.click();
    await expect(importer).toBeHidden();
    await expect(
      dialog.getByRole('button', { name: importedTheme.name, exact: true })
    ).toBeVisible();
    await expectScreenshot('theme-file-imported', {
      target: dialog,
      ready: () =>
        expect(dialog.getByRole('button', { name: importedTheme.name, exact: true })).toBeVisible()
    });
    await dialog.getByRole('button', { name: copy.CreateTheme, exact: true }).click();
    const creator = page.getByRole('dialog', { name: copy.CreateTheme, exact: true });

    await creator
      .getByRole('textbox', { name: copy.ThemeJson })
      .fill(JSON.stringify(reviewTheme, null, 2));
    await expectScreenshot('theme-create-draft', {
      target: creator,
      ready: () =>
        expect(creator.getByRole('textbox', { name: copy.ThemeJson })).toHaveValue(
          JSON.stringify(reviewTheme, null, 2)
        )
    });
    await creator.getByRole('button', { name: copy.Save, exact: true }).click();
    await expect(creator).toBeHidden();
    const custom = dialog.getByRole('button', { name: reviewTheme.name, exact: true });

    await expect(custom).toBeVisible();
    await custom.click();
    await expect(custom).toHaveAttribute('aria-pressed', 'true');
    await expect(custom).toBeEnabled();
    await expectScreenshot('theme-created-selected', {
      target: dialog,
      center: custom,
      ready: () => expect(custom).toHaveAttribute('aria-pressed', 'true')
    });
    await dialog
      .getByRole('button', { name: `${copy.EditTheme}: ${reviewTheme.name}`, exact: true })
      .click();
    const editor = page.getByRole('dialog', { name: copy.EditTheme, exact: true });
    const edited = { ...reviewTheme, name: 'Settings review edited' };

    await editor
      .getByRole('textbox', { name: copy.ThemeJson })
      .fill(JSON.stringify(edited, null, 2));
    await expectScreenshot('theme-edit-draft', {
      target: editor,
      ready: () =>
        expect(editor.getByRole('button', { name: copy.Save, exact: true })).toBeEnabled()
    });
    await editor.getByRole('button', { name: copy.Save, exact: true }).click();
    await expect(editor).toBeHidden();
    const downloadEvent = page.waitForEvent('download');

    await dialog
      .getByRole('button', { name: `${copy.ExportTheme}: ${edited.name}`, exact: true })
      .click();
    const download = await downloadEvent;

    expect(download.suggestedFilename()).toBe(`${reviewTheme.id}.json`);
    expect(JSON.parse(await Bun.file((await download.path())!).text())).toMatchObject(edited);
    await dialog
      .getByRole('button', { name: `${copy.DuplicateTheme}: ${edited.name}`, exact: true })
      .click();
    await creator
      .getByRole('textbox', { name: copy.ThemeJson })
      .fill(
        JSON.stringify({ ...reviewTheme, id: 'settings-copy', name: 'Settings copy' }, null, 2)
      );
    await expectScreenshot('theme-duplicate-draft', {
      target: creator,
      ready: () => expect(creator).toBeVisible()
    });
    await creator.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(creator).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Settings copy', exact: true })).toHaveCount(0);
    await dialog
      .getByRole('button', { name: `${copy.DuplicateTheme}: ${edited.name}`, exact: true })
      .click();
    const duplicate = { ...reviewTheme, id: 'settings-copy', name: 'Settings copy' };

    await creator
      .getByRole('textbox', { name: copy.ThemeJson })
      .fill(JSON.stringify(duplicate, null, 2));
    await creator.getByRole('button', { name: copy.Save, exact: true }).click();
    await expect(creator).toBeHidden();
    await expectScreenshot('theme-duplicate-saved', {
      target: dialog,
      ready: () =>
        expect(dialog.getByRole('button', { name: duplicate.name, exact: true })).toBeVisible()
    });
    await dialog
      .getByRole('button', { name: `${copy.DeleteTheme}: ${edited.name}`, exact: true })
      .click();
    const removal = page.getByRole('alertdialog', { name: copy.DeleteTheme, exact: true });
    const confirm = removal.getByRole('button', { name: copy.DeleteTheme, exact: true });

    await expect(confirm).toBeDisabled();
    await removal.getByRole('textbox').fill('wrong confirmation');
    await expect(confirm).toBeDisabled();
    await expectScreenshot('theme-delete-wrong-confirmation', {
      target: removal,
      ready: () => expect(confirm).toBeDisabled()
    });
    await removal.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(removal).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await expect(dialog.getByRole('button', { name: edited.name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await dialog
      .getByRole('button', { name: `${copy.DeleteTheme}: ${edited.name}`, exact: true })
      .click();
    await expect(removal.getByRole('textbox')).toHaveValue('');
    await removal.getByRole('textbox').fill(copy.DeleteConfirmationWord);
    await expect(confirm).toBeEnabled();
    await expectScreenshot('theme-delete-confirmed', {
      target: removal,
      ready: () => expect(confirm).toBeEnabled()
    });
    await confirm.click();
    await expect(removal).toBeHidden();
    await expect(dialog.getByRole('button', { name: edited.name, exact: true })).toHaveCount(0);
    await expectAccessibility('appearance-after-theme-removal');
    await expectScreenshot('theme-deleted', {
      target: dialog,
      ready: () =>
        expect(dialog.getByRole('button', { name: edited.name, exact: true })).toHaveCount(0)
    });
  }
);

testE2e(
  'Project settings validate names edit identities and guard deletion',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });
    const navigation = dialog.getByRole('navigation');

    await navigation.getByRole('button', { name: copy.ProjectSettingsTitle, exact: true }).click();
    await expect(dialog.getByText(copy.NoProjectsYet, { exact: true })).toBeVisible();
    await expectScreenshot('projects-empty', {
      target: dialog,
      ready: () => expect(dialog.getByText(copy.NoProjectsYet, { exact: true })).toBeVisible()
    });
    await dialog.getByRole('button', { name: copy.Close, exact: true }).click();
    await page.getByRole('combobox', { name: copy.ChooseProject }).click();
    await page
      .locator('[data-slot="combobox-popup"]')
      .getByRole('button', { name: copy.NewProject, exact: true })
      .click();
    const create = page.getByRole('dialog', { name: copy.NewProject, exact: true });

    await create
      .getByRole('textbox', { name: copy.ProjectName, exact: true })
      .fill('Settings subject');
    await expectScreenshot('project-create', {
      target: create,
      ready: () =>
        expect(create.getByRole('button', { name: copy.CreateProject, exact: true })).toBeEnabled()
    });
    await create.getByRole('button', { name: copy.CreateProject, exact: true }).click();
    await expect(create).toBeHidden();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.ProjectSettingsTitle, exact: true }).click();
    await expectScreenshot('projects-index', {
      target: dialog,
      ready: () =>
        expect(dialog.getByRole('button', { name: 'Settings subject', exact: true })).toBeVisible()
    });
    await dialog.getByRole('button', { name: 'Settings subject', exact: true }).click();
    const name = dialog.getByRole('textbox', { name: copy.ProjectName, exact: true });
    const save = name
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: copy.Save, exact: true });

    await expect(save).toBeDisabled();
    await expectScreenshot('project-details', {
      target: dialog,
      ready: () => expect(name).toHaveValue('Settings subject')
    });

    for (const [index, value] of ['', '   '].entries()) {
      await name.fill(value);
      await expect(save).toBeDisabled();
      await expectScreenshot(`project-invalid-name-${index}`, {
        target: dialog,
        ready: () => expect(save).toBeDisabled()
      });
    }

    await name.fill('S'.repeat(201));
    await expect(name).toHaveValue('S'.repeat(200));
    await expect(save).toBeDisabled();
    await expectScreenshot('project-name-length-limit', {
      target: dialog,
      ready: () => expect(name).toHaveValue('S'.repeat(200))
    });
    await name.fill('S'.repeat(101));
    await expect(save).toBeDisabled();
    await expectScreenshot('project-name-domain-limit', {
      target: dialog,
      ready: () => expect(save).toBeDisabled()
    });
    await name.fill('S'.repeat(100));
    await expect(save).toBeEnabled();
    await name.press('Enter');
    await expect(save).toBeDisabled();
    await expectScreenshot('project-name-maximum-saved', {
      target: dialog,
      ready: () => expect(name).toHaveValue('S'.repeat(100))
    });
    await name.fill('Renamed settings subject');
    await name.press('Enter');
    await expect(save).toBeDisabled();
    await expect(
      dialog.getByRole('heading', { name: 'Renamed settings subject', exact: true })
    ).toBeVisible();
    await expectScreenshot('project-renamed', {
      target: dialog,
      ready: () => expect(name).toHaveValue('Renamed settings subject')
    });
    await dialog.getByRole('button', { name: copy.SubjectIconChange, exact: true }).click();
    const icon = page.getByRole('dialog', { name: copy.SubjectIconTitle, exact: true });

    await expectScreenshot('project-icon-automatic', {
      target: icon,
      ready: () =>
        expect(
          icon.getByRole('button', { name: copy.SubjectIconAutomatic, exact: true })
        ).toHaveAttribute('aria-pressed', 'true')
    });
    await icon.getByRole('button', { name: copy.SubjectIconCustom, exact: true }).click();
    const letters = icon.getByRole('textbox', { name: copy.SubjectIconLetters, exact: true });
    const saveIcon = icon.getByRole('button', { name: copy.Save, exact: true });

    for (const [index, value] of ['', 'A B', 'ABCD'].entries()) {
      await letters.fill(value);
      await expect(saveIcon).toBeDisabled();
      await expectScreenshot(`project-monogram-invalid-${index}`, {
        target: icon,
        ready: () => expect(saveIcon).toBeDisabled()
      });
    }

    await letters.fill('èc');
    await expect(letters).toHaveValue('ÈC');
    await expect(saveIcon).toBeEnabled();
    await expectScreenshot('project-monogram-valid', {
      target: icon,
      ready: () => expect(letters).toHaveValue('ÈC')
    });
    await icon.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(icon).toBeHidden();
    await dialog.getByRole('button', { name: copy.SubjectIconChange, exact: true }).click();
    await expect(
      icon.getByRole('button', { name: copy.SubjectIconAutomatic, exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await icon.getByRole('button', { name: copy.SubjectIconCustom, exact: true }).click();
    await letters.fill('èc');
    await saveIcon.click();
    await expect(icon).toBeHidden();
    await dialog.getByRole('button', { name: copy.SubjectIconChange, exact: true }).click();
    await expect(letters).toHaveValue('ÈC');
    await expectScreenshot('project-monogram-reopened', {
      target: icon,
      ready: () => expect(letters).toHaveValue('ÈC')
    });
    await icon.getByRole('button', { name: copy.SubjectIconSymbols, exact: true }).click();
    const symbolSearch = icon.getByRole('textbox', { name: copy.SubjectIconSearch, exact: true });

    await symbolSearch.fill('no-symbol-928');
    await expect(icon.getByText(copy.SearchNoResults, { exact: true })).toBeVisible();
    await expectScreenshot('project-symbol-search-empty', {
      target: icon,
      ready: () => expect(icon.getByText(copy.SearchNoResults, { exact: true })).toBeVisible()
    });
    await symbolSearch.fill('');
    const symbols = icon.getByRole('radiogroup', { name: copy.SubjectIconSymbols, exact: true });

    async function captureIconChoices(group: typeof symbols, prefix: string) {
      const choices = group.getByRole('radio');

      await expect(group).toBeVisible();
      const count = await choices.count();

      expect(count).toBeGreaterThan(1);

      for (let index = 0; index < count; index++) {
        await choices.nth(index).click();
        await expectScreenshot(`${prefix}-${index}`, {
          target: icon,
          ready: () => expect(choices.nth(index)).toBeChecked()
        });
      }

      await choices.nth(1).click();
    }

    await captureIconChoices(symbols, 'project-symbol');
    await expectScreenshot('project-symbol-selected', {
      target: icon,
      ready: () => expect(symbols.getByRole('radio').nth(1)).toBeChecked()
    });
    await saveIcon.click();
    await expect(icon).toBeHidden();
    await dialog.getByRole('button', { name: copy.SubjectIconChange, exact: true }).click();
    await expect(symbols.getByRole('radio').nth(1)).toBeChecked();
    await expectScreenshot('project-symbol-reopened', {
      target: icon,
      ready: () => expect(symbols.getByRole('radio').nth(1)).toBeChecked()
    });
    await icon.getByRole('button', { name: copy.SubjectIconEmojis, exact: true }).click();
    const emojis = icon.getByRole('radiogroup', { name: copy.SubjectIconEmojis, exact: true });

    await captureIconChoices(emojis, 'project-emoji');
    await expectScreenshot('project-emoji-selected', {
      target: icon,
      ready: () => expect(emojis.getByRole('radio').nth(1)).toBeChecked()
    });
    const colors = icon.getByRole('radiogroup', { name: copy.SubjectIconColor, exact: true });

    await captureIconChoices(colors, 'project-color');
    await expectScreenshot('project-color-selected', {
      target: icon,
      ready: () => expect(colors.getByRole('radio').nth(1)).toBeChecked()
    });
    await saveIcon.click();
    await expect(icon).toBeHidden();
    await expectScreenshot('project-identity-saved', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('button', { name: copy.SubjectIconChange, exact: true })
        ).toBeEnabled()
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await navigation.getByRole('button', { name: copy.ProjectSettingsTitle, exact: true }).click();
    await dialog.getByRole('button', { name: 'Renamed settings subject', exact: true }).click();
    await expect(name).toHaveValue('Renamed settings subject');
    await dialog.getByRole('button', { name: copy.SubjectIconChange, exact: true }).click();
    await expect(emojis.getByRole('radio').nth(1)).toBeChecked();
    await expect(colors.getByRole('radio').nth(1)).toBeChecked();
    await expectScreenshot('project-identity-reopened', {
      target: icon,
      ready: () => expect(emojis.getByRole('radio').nth(1)).toBeChecked()
    });
    await icon.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(icon).toBeHidden();
    await dialog.getByRole('button', { name: copy.ProjectSettingsDelete, exact: true }).click();
    const removal = page.getByRole('alertdialog', {
      name: copy.ProjectSettingsDelete,
      exact: true
    });
    const confirm = removal.getByRole('button', { name: copy.ProjectSettingsDelete, exact: true });

    await expect(confirm).toBeDisabled();
    await removal.getByRole('textbox').fill('wrong subject');
    await expect(confirm).toBeDisabled();
    await expectScreenshot('project-delete-wrong-name', {
      target: removal,
      ready: () => expect(confirm).toBeDisabled()
    });
    await removal.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(removal).toBeHidden();
    await expect(name).toHaveValue('Renamed settings subject');
    await dialog.getByRole('button', { name: copy.ProjectSettingsDelete, exact: true }).click();
    await expect(removal.getByRole('textbox')).toHaveValue('');
    await removal.getByRole('textbox').fill('Renamed settings subject');
    await expect(confirm).toBeEnabled();
    await expectScreenshot('project-delete-confirmed', {
      target: removal,
      ready: () => expect(confirm).toBeEnabled()
    });
    await confirm.click();
    await expect(removal).toBeHidden();
    await expect(dialog.getByText(copy.NoProjectsYet, { exact: true })).toBeVisible();
    await expectAccessibility('projects-after-delete');
    await expectScreenshot('projects-deleted', {
      target: dialog,
      ready: () => expect(dialog.getByText(copy.NoProjectsYet, { exact: true })).toBeVisible()
    });
  }
);

testE2e(
  'Data settings recover invalid imports and guard backup deletion and restore',
  async ({ page, expectScreenshot, expectAccessibility }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.Settings });

    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.DataSettingsTitle, exact: true })
      .click();
    const create = dialog.getByRole('button', { name: copy.DataCreate, exact: true });

    await expect(create).toBeEnabled();
    await expect(dialog.getByText(copy.DataEmptyTitle, { exact: true })).toBeVisible();
    await expectScreenshot('data-empty', {
      target: dialog,
      ready: () => expect(create).toBeEnabled()
    });

    for (const [index, buffer] of [
      Buffer.from(''),
      Buffer.from('This is not a Study backup.'),
      Buffer.from('STUDYBK1\ncorrupt-archive')
    ].entries()) {
      await dialog
        .locator('input[type="file"]')
        .and(dialog.getByLabel(copy.DataImport, { exact: true }))
        .setInputFiles({
          name: 'invalid.studybackup',
          mimeType: 'application/octet-stream',
          buffer
        });
      await expect(
        dialog.getByText(index < 2 ? copy.DataFileError : copy.DataUncertain, { exact: true })
      ).toBeVisible();
      await expect(create).toBeDisabled();
      await expectScreenshot(`data-invalid-import-${index}`, {
        target: dialog,
        ready: () => expect(create).toBeDisabled()
      });
      await dialog.getByRole('button', { name: copy.DataRefresh, exact: true }).click();

      if (index === 2) {
        const acknowledge = dialog.getByRole('button', { name: copy.DataAcknowledge, exact: true });

        await expect(acknowledge).toBeEnabled();
        await expect(create).toBeDisabled();
        await expectScreenshot('data-uncertain-after-refresh', {
          target: dialog,
          ready: () => expect(acknowledge).toBeEnabled()
        });
        await acknowledge.click();
      }

      await expect(create).toBeEnabled();
      await expect(dialog.getByText(copy.DataEmptyTitle, { exact: true })).toBeVisible();
    }

    await create.click();
    const preview = dialog.getByRole('button', { name: copy.DataPreview, exact: true });
    const downloadButton = dialog.getByRole('button', { name: copy.DataDownload, exact: true });

    await expect(preview).toHaveCount(1);
    await expect(preview).toBeEnabled();
    await expectAccessibility('saved-backup');
    await expectScreenshot('data-created', {
      target: dialog,
      ready: () => expect(preview).toBeEnabled()
    });
    const downloadEvent = page.waitForEvent('download');

    await downloadButton.click();
    const download = await downloadEvent;

    expect(download.suggestedFilename()).toMatch(/\.studybackup$/);
    const backup = await Bun.file((await download.path())!).bytes();

    expect(new TextDecoder().decode(backup.slice(0, 9))).toBe('STUDYBK1\n');
    await expect(downloadButton).toBeEnabled();
    await preview.click();
    const restore = page.getByRole('alertdialog', { name: copy.DataPreview, exact: true });
    const accept = restore.getByRole('button', { name: copy.DataAccept, exact: true });

    await expect(accept).toBeDisabled();
    await expectScreenshot('data-restore-preview', {
      target: restore,
      ready: () => expect(restore.getByRole('table')).toBeVisible()
    });
    await restore.getByRole('textbox').fill('wrong confirmation');
    await expect(accept).toBeDisabled();
    await expectScreenshot('data-restore-wrong-confirmation', {
      target: restore,
      ready: () => expect(accept).toBeDisabled()
    });
    await restore.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(restore).toBeHidden();
    const remove = dialog.getByRole('button', { name: copy.DataDelete, exact: true });

    await remove.click();
    const deletion = page.getByRole('alertdialog', { name: copy.DataDelete, exact: true });
    const confirmDelete = deletion.getByRole('button', { name: copy.DataDelete, exact: true });

    await expect(confirmDelete).toBeDisabled();
    await deletion.getByRole('textbox').fill('wrong');
    await expect(confirmDelete).toBeDisabled();
    await expectScreenshot('data-delete-wrong-confirmation', {
      target: deletion,
      ready: () => expect(confirmDelete).toBeDisabled()
    });
    await deletion.getByRole('button', { name: copy.Cancel, exact: true }).click();
    await expect(deletion).toBeHidden();
    await remove.click();
    await expect(deletion.getByRole('textbox')).toHaveValue('');
    await deletion.getByRole('textbox').fill(copy.DeleteConfirmationWord);
    await expectScreenshot('data-delete-confirmed', {
      target: deletion,
      ready: () => expect(confirmDelete).toBeEnabled()
    });
    await confirmDelete.click();
    await expect(deletion).toBeHidden();
    await expect(dialog.getByText(copy.DataEmptyTitle, { exact: true })).toBeVisible();
    await expectScreenshot('data-deleted', {
      target: dialog,
      ready: () => expect(preview).toHaveCount(0)
    });
    await dialog
      .locator('input[type="file"]')
      .and(dialog.getByLabel(copy.DataImport, { exact: true }))
      .setInputFiles({
        name: 'round-trip.studybackup',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(backup)
      });
    await expect(preview).toHaveCount(1);
    await expect(preview).toBeEnabled();
    await expectScreenshot('data-imported', {
      target: dialog,
      ready: () => expect(preview).toBeEnabled()
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await dialog
      .getByRole('navigation')
      .getByRole('button', { name: copy.DataSettingsTitle, exact: true })
      .click();
    await expect(preview).toHaveCount(1);
    await expect(preview).toBeEnabled();
    await preview.click();
    await restore.getByRole('textbox').fill(copy.DataRestoreConfirmationWord);
    await expect(accept).toBeEnabled();
    await expectScreenshot('data-restore-confirmed', {
      target: restore,
      ready: () => expect(accept).toBeEnabled()
    });
    await accept.click();
    await expect(restore).toBeHidden();
    await expect(
      dialog.getByText(copy['DataStaterestart-required'], { exact: true })
    ).toBeVisible();
    await expect(create).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: copy.DataDiscard, exact: true })
    ).toBeDisabled();
    await expectScreenshot('data-restore-restart-required', {
      target: dialog,
      ready: () => expect(create).toBeDisabled()
    });
  }
);
