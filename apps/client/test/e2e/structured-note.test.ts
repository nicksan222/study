import { Appearance, Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { Locator } from 'playwright';

const copy = catalogs.english;

const code = Array.from({ length: 50 }, (_, index) => {
  const sentinel =
    index === 0 ? 'FIRST' : index === 24 ? 'MIDDLE' : index === 49 ? 'LAST' : 'sample';

  return `record(${String(index + 1).padStart(2, '0')}, "${sentinel}");`;
}).join('\n');

const original = [
  '# River systems lecture',
  '## Observation methods',
  'Use a **calibrated gauge** and an *independent reading*. Keep `riverStage` in the log.',
  '- Measure the river\n  - Read the shaded gauge\n    - Record the calibration',
  '1. Prepare the samples\n2. Compare the readings\n3. Retain the evidence',
  '> Preserve the original observation before drawing a conclusion.',
  '## Reference and comparison',
  `[Lecture reference](https://example.invalid/lecture/${'river-systems-observations-'.repeat(12)}end)`,
  '| Site | Morning observation | Afternoon observation | Equipment and calibration | Evidence retained |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    `| North bank | ${'Clear water; '.repeat(8)}| Stable level | Calibrated gauge | TABLE-END |`,
  '## Reproducible records',
  '```ts\n' + code + '\n```',
  '## Conclusion\nEND-OF-LECTURE: retain every observation and its original order.'
].join('\n\n');

test.browser.stable(
  'Structured lecture notes preserve edits and readable layout',
  async ({ page, expectScreenshot, expect, study }) => {
    await page.goto('/notes');
    expect(page.viewportSize()).toEqual({ width: 2560, height: 1440 });
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    await composer.fill(original);
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    const lectureUrl = page.url();
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const entry = notebook.locator('[data-role="user"]');
    const body = entry.locator('.chat-message-content');
    const scrollHost = page.locator('[data-notebook-scroll-host]');
    const title = body.getByRole('heading', { name: 'River systems lecture', level: 1 });
    const table = body.getByRole('table');
    const codeBlock = body.locator('pre > code');
    const conclusion = body.getByRole('heading', { name: 'Conclusion', level: 2 });
    const outline = page
      .getByRole('navigation', { name: copy.NoteOutline })
      .getByRole('button')
      .first();

    await page.reload();
    await expect(title).toBeVisible();
    await entry.hover();
    await entry.getByRole('button', { name: copy.NoteEditNote }).click();
    const visualDialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const visualEditor = visualDialog.getByRole('textbox', { name: copy.NoteEditNote });

    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    await expect(
      visualEditor.getByRole('heading', { name: 'River systems lecture' })
    ).toBeVisible();
    await expect(visualEditor.getByRole('table')).toBeVisible();
    await expect(visualEditor.locator('pre > code')).toHaveJSProperty('textContent', code);
    await visualDialog.getByRole('button', { name: copy.NoteMarkdownSource }).click();
    await expect(visualEditor).toHaveValue(original);
    await visualDialog.getByRole('button', { name: copy.NoteDiscardEdits }).click();
    await expect(visualDialog).toBeHidden();
    await expect(body.locator('strong')).toHaveText('calibrated gauge');
    await expect(body.locator('em')).toHaveText('independent reading');
    await expect(body.getByText('riverStage', { exact: true })).toHaveJSProperty('tagName', 'CODE');
    await expect(body.locator('ul ul ul li')).toHaveText('Record the calibration');
    await expect(body.locator('ol > li')).toHaveText([
      'Prepare the samples',
      'Compare the readings',
      'Retain the evidence'
    ]);
    await expect(body.locator('blockquote')).toHaveText(
      'Preserve the original observation before drawing a conclusion.'
    );
    const link = body.getByRole('link', { name: 'Lecture reference' });

    await expect(link).toHaveAttribute('href', /https:\/\/example\.invalid\/lecture\/.*end$/);
    await expect(table.getByRole('columnheader')).toHaveCount(5);
    await expect(table.getByRole('cell').last()).toHaveText('TABLE-END');
    await expect(codeBlock).toHaveJSProperty('textContent', code);
    await study.settings({ appearance: Appearance.DARK, zoomPercent: 100 });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.reload();
    await title.scrollIntoViewIfNeeded();
    await expectScreenshot('desktop-dark-reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(title).toBeInViewport()
    });

    await study.settings({ appearance: Appearance.LIGHT, zoomPercent: 100 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await title.scrollIntoViewIfNeeded();
    await expectScreenshot('phone-light-reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(title).toBeInViewport()
    });
    const tableScroll = body.locator('.tableWrapper');

    await tableScroll.scrollIntoViewIfNeeded();
    await expect(tableScroll).toHaveJSProperty('scrollLeft', 0);
    await tableScroll.press('ArrowRight');
    await expect(tableScroll).toBeFocused();
    await expect(tableScroll).not.toHaveJSProperty('scrollLeft', 0);

    for (let step = 0; step < 10; step++) await tableScroll.press('ArrowRight');

    await expect(table.getByRole('cell').last()).toBeInViewport();

    await study.settings({ appearance: Appearance.DARK, zoomPercent: 125 });
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.reload();

    await link.focus();
    await expect(link).toBeFocused();
    await expect(outline).toContainText('River systems lecture');
    await expect(outline).not.toContainText('# River systems lecture');
    await outline.focus();
    await outline.press('Enter');
    await expect(outline).toHaveAttribute('aria-current', 'location');
    await expect(notebook.locator('.note-index-target')).toBeFocused();

    const fullyVisible = async (
      { expect }: Pick<test.browser.Context, 'expect'>,
      target: Locator
    ) => {
      await expect(target).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => {
          const box = await target.boundingBox();
          const viewport = page.viewportSize();

          return (
            !!box &&
            !!viewport &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width &&
            box.y + box.height <= viewport.height
          );
        })
        .toBe(true);
    };

    await expectScreenshot('structured-top', {
      target: 'viewport',
      ready: () => expect(title).toBeInViewport()
    });

    await expectScreenshot('wide-content', {
      target: table,
      ready: () => expect(table).toBeVisible()
    });

    await scrollHost.press('End');
    await expect(conclusion).toBeInViewport();
    await expect
      .poll(async () => {
        const text = await body.boundingBox();
        const capture = await page.locator('.workspace-desk-capture').boundingBox();

        return !!text && !!capture && text.y + text.height <= capture.y;
      })
      .toBe(true);
    await expect(composer).toBeHidden();
    await fullyVisible(
      { expect },
      page.getByRole('button', { name: copy.NoteAddCapture, exact: true })
    );
    await expectScreenshot('code-bottom', {
      target: 'viewport',
      ready: () => expect(conclusion).toBeInViewport()
    });

    await body.getByText('riverStage', { exact: true }).dblclick();
    await page.keyboard.press('ControlOrMeta+c');

    let content = original;

    for (const [before, after] of [
      ['2. Compare the readings', '2. Compare the calibrated readings'],
      ['record(25, "MIDDLE");', 'record(25, "MIDDLE: checked twice");']
    ] as const) {
      await notebook.locator('[data-role="user"]').hover();
      const editedText = body.getByText(after.replace(/^2\. /, ''), {
        exact: before.startsWith('2.')
      });
      const edit = page.getByRole('button', { name: copy.NoteEditNote });

      await edit.scrollIntoViewIfNeeded();
      await fullyVisible({ expect }, edit);
      await edit.click();
      const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });

      await dialog.getByRole('button', { name: copy.NoteMarkdownSource, exact: true }).click();
      const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });
      const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

      await expect(editor).toHaveValue(content);

      if (content === original) {
        await editor.fill('');
        await editor.press('ControlOrMeta+v');
        await expect(editor).toHaveValue('riverStage');
      }

      content = content.replace(before, after);
      await editor.fill(content);
      await editor.press('Control+Home');
      await expect(editor).toHaveJSProperty('selectionStart', 0);
      await editor.press('Control+End');
      await expect(editor).toHaveJSProperty('selectionStart', content.length);
      await expect(dialog.locator('.notebook-editor-body')).not.toHaveJSProperty('scrollTop', 0);
      await editor.press('Home');

      for (let line = 0; line < 4; line++) await editor.press('ArrowUp');

      // Visit every code line from LAST through MIDDLE to FIRST, checking the caret's exact offset.
      const codeLines = content
        .slice(content.indexOf('record(01,'), content.lastIndexOf('\n```'))
        .split('\n');

      for (const line of codeLines.toReversed()) {
        await expect(editor).toHaveJSProperty('selectionStart', content.indexOf(line));
        await editor.press('ArrowUp');
      }

      await expect(editor.locator(':scope:focus-visible')).toHaveCount(1);
      await fullyVisible({ expect }, dialog);
      await fullyVisible({ expect }, dialog.locator('.notebook-editor-body'));

      if (before.startsWith('2.')) await editor.press('Control+Home');

      await editor.press('Tab');
      await expect(
        dialog.getByRole('button', { name: copy.VoiceStart, exact: true })
      ).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: copy.NoteDiscardEdits })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(save).toBeFocused();
      await fullyVisible({ expect }, save);
      await expect(save.locator(':scope:focus-visible')).toHaveCount(1);
      await expectScreenshot(before.startsWith('2.') ? 'editing-list' : 'editing-code', {
        target: dialog,
        ready: () => expect(editor).toHaveValue(content)
      });
      await save.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(title).toBeVisible();
      await expect(editedText).toBeVisible();

      await page.goto('/notes');
      await composer.fill('Second lecture: a separate note for navigation checks.');
      await page.getByRole('button', { name: copy.NoteSaveNote }).click();
      await expect(page).toHaveURL(/\/notes\/.+/);
      expect(page.url()).not.toBe(lectureUrl);
      const secondUrl = page.url();

      await expect(body.locator('.chat-message-text')).toHaveText(
        'Second lecture: a separate note for navigation checks.'
      );
      await page
        .getByRole('navigation', { name: copy.Notes, exact: true })
        .locator('a[href="' + new URL(lectureUrl).pathname + '"]')
        .click();
      await expect(page).toHaveURL(lectureUrl);
      await expect(title).toBeVisible();
      await expect(editedText).toBeVisible();
      await page.reload();
      await expect(title).toBeVisible();
      await expect(editedText).toBeVisible();
      expect(secondUrl).not.toBe(page.url());
    }

    await notebook.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });

    await dialog.getByRole('button', { name: copy.NoteMarkdownSource, exact: true }).click();
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    await expect(editor).toHaveValue(content);
    await editor.press('ControlOrMeta+a');
    await editor.press('ControlOrMeta+c');
    await editor.fill('');
    await editor.press('ControlOrMeta+v');
    await expect(editor).toHaveValue(content);
    await editor.press('Control+End');
    await editor.press('Home');

    // Conclusion plus 26 upward lines places the corrected middle sentinel in the editor.
    for (let line = 0; line < 29; line++) await editor.press('ArrowUp');

    await expect(editor).toHaveJSProperty('selectionStart', content.indexOf('record(25,'));
    await expect(editor).toBeFocused();
    await fullyVisible({ expect }, dialog.locator('.notebook-editor-body'));
    await fullyVisible({ expect }, dialog.getByRole('button', { name: copy.NoteSaveNote }));
    await expectScreenshot('edited-reopened', {
      target: dialog,
      ready: () => expect(editor).toHaveValue(content)
    });
    await dialog.getByRole('button', { name: copy.NoteBackToNotebook }).click();
    await body.click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.NoteArchive, exact: true }).click();
    await expect(title).toHaveCount(0);

    const archived = page.getByRole('button', { name: copy.NoteArchived, exact: true });

    if (!(await archived.isVisible())) {
      await page.getByRole('button', { name: copy.NoteActions, exact: true }).click();
    }

    await archived.click();
    const archive = page.getByRole('dialog', { name: copy.NoteArchived });

    await archive
      .getByRole('complementary', { name: copy.NoteArchived })
      .getByRole('button')
      .click();
    await expect(
      archive.getByRole('heading', { name: 'River systems lecture', level: 1 })
    ).toBeVisible();
    await expect(archive.getByRole('table').getByRole('cell').last()).toHaveText('TABLE-END');
    await expect(archive.locator('pre > code')).toContainText('MIDDLE: checked twice');
    await archive.getByRole('button', { name: copy.NoteRestore, exact: true }).click();
    await archive.getByRole('button', { name: copy.Close, exact: true }).click();
    await expect(title).toBeVisible();

    const italian = catalogs.italian;

    await study.settings({ language: Language.ITALIAN, appearance: Appearance.LIGHT });
    await page.setViewportSize({ width: 760, height: 900 });
    await page.reload();
    const italianNotebook = page.getByRole('region', { name: italian.NoteNotebook });

    await expect(
      italianNotebook.getByRole('heading', { name: 'River systems lecture' })
    ).toBeVisible();
    await expect(italianNotebook.getByRole('link', { name: 'Lecture reference' })).toBeVisible();
    await scrollHost.press('ArrowRight');
    await expect(scrollHost).toHaveJSProperty('scrollLeft', 0);

    const arabic = 'ملاحظات المحاضرة 123.';
    const italianEntry = italianNotebook.locator('[data-role="user"]');

    await italianEntry.hover();
    await italianEntry.getByRole('button', { name: italian.NoteEditNote }).click();
    const italianDialog = page.getByRole('dialog', { name: italian.NoteEditNote });
    const italianEditor = italianDialog.getByRole('textbox', { name: italian.NoteEditNote });

    await expect(italianEditor).toBeFocused();
    await expect(italianDialog).toHaveCSS('translate', '0px');
    const closing = italianEditor.getByText(
      'END-OF-LECTURE: retain every observation and its original order.',
      { exact: true }
    );

    await closing.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await expect(closing).toBeVisible();
    await expect(italianEditor.locator('p').last()).toBeEmpty();
    await page.keyboard.insertText(arabic);
    const paragraph = italianEditor.getByText(arabic, { exact: true });

    await expect(paragraph).toHaveCSS('direction', 'rtl');
    await expectScreenshot('visual-edit-arabic', {
      target: italianDialog,
      ready: () => expect(paragraph).toBeInViewport()
    });
    await italianDialog.getByRole('button', { name: italian.NoteSaveNote }).click();
    await expect(italianDialog).toBeHidden();
    await page.reload();
    await expect(italianNotebook.getByText(arabic, { exact: true })).toBeVisible();
    await expect(italianNotebook.getByRole('table').getByRole('cell').last()).toHaveText(
      'TABLE-END'
    );
    await expect(italianNotebook.locator('pre > code')).toContainText('MIDDLE: checked twice');
  }
);
