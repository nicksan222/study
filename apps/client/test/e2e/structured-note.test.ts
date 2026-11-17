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
  async ({ page, expectScreenshot, expect }) => {
    await page.goto('/notes');
    expect(page.viewportSize()).toEqual({ width: 2560, height: 1440 });
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });

    await composer.fill(original);
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    const lectureUrl = page.url();
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const body = notebook.locator('.chat-message-text');
    const label = body;
    const scrollHost = page.locator('[data-notebook-scroll-host]');

    // Plain notes have one text node: geometry tracks its position; captures show the visible lines.
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

    await expect(body).toHaveText(original);
    await page
      .getByRole('navigation', { name: copy.NoteOutline })
      .getByRole('button')
      .first()
      .click();
    await expect(label).toHaveVisibleText(original.split('\n')[0]!);
    await expect(body).toHaveCSS('overflow-wrap', 'anywhere');
    await expect
      .poll(async () => {
        const text = await body.boundingBox();
        const host = await scrollHost.boundingBox();

        return !!text && !!host && text.x >= host.x && text.x + text.width <= host.x + host.width;
      })
      .toBe(true);
    await expectScreenshot('structured-top', {
      target: 'viewport',
      ready: () => expect(label).toHaveVisibleText(original.split('\n')[0]!)
    });
    const top = await body.boundingBox();

    for (let step = 0; step < 8; step++) await scrollHost.press('ArrowDown');

    await expect.poll(async () => (await body.boundingBox())!.y).toBeLessThan(top!.y);
    await expect(label).not.toHaveVisibleText(original.split('\n')[0]!);
    await expect(composer).toBeHidden();
    await expectScreenshot('wide-content', {
      target: 'viewport',
      ready: () => expect(body).toHaveText(original)
    });
    const middle = await body.boundingBox();

    await scrollHost.press('End');
    await expect.poll(async () => (await body.boundingBox())!.y).toBeLessThan(middle!.y);
    await expect
      .poll(async () => {
        const text = await body.boundingBox();
        const floating = await page.locator('.workspace-desk-capture').boundingBox();

        return !!text && !!floating && text.y + text.height <= floating.y;
      })
      .toBe(true);
    await expect(composer).toBeHidden();
    await fullyVisible(
      { expect },
      page.getByRole('button', { name: copy.NoteAddCapture, exact: true })
    );
    await expectScreenshot('code-bottom', {
      target: 'viewport',
      ready: () => expect(body).toHaveText(original)
    });

    let content = original;

    for (const [before, after] of [
      ['2. Compare the readings', '2. Compare the calibrated readings'],
      ['record(25, "MIDDLE");', 'record(25, "MIDDLE: checked twice");']
    ] as const) {
      await notebook.locator('[data-role="user"]').hover();
      const edit = page.getByRole('button', { name: copy.NoteEditNote });

      await edit.scrollIntoViewIfNeeded();
      await fullyVisible({ expect }, edit);
      await edit.click();
      const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
      const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });
      const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

      await expect(editor).toHaveValue(content);
      content = content.replace(before, after);
      await editor.fill(content);
      await editor.press('Control+Home');
      await expect(editor).toHaveJSProperty('selectionStart', 0);
      await editor.press('Control+End');
      await expect(editor).toHaveJSProperty('selectionStart', content.length);
      await expect(editor).not.toHaveJSProperty('scrollTop', 0);
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
      await fullyVisible({ expect }, editor);
      await editor.press('Tab');
      await expect(save).toBeFocused();
      await fullyVisible({ expect }, save);
      await expect(save.locator(':scope:focus-visible')).toHaveCount(1);
      await expectScreenshot(before.startsWith('2.') ? 'editing-list' : 'editing-code', {
        target: dialog,
        ready: () => expect(editor).toHaveValue(content)
      });
      await save.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(body).toHaveText(content);

      await page.goto('/notes');
      await composer.fill('Second lecture: a separate note for navigation checks.');
      await page.getByRole('button', { name: copy.NoteSaveNote }).click();
      await expect(page).toHaveURL(/\/notes\/.+/);
      expect(page.url()).not.toBe(lectureUrl);
      const secondUrl = page.url();

      await expect(body).toHaveText('Second lecture: a separate note for navigation checks.');
      await page
        .getByRole('navigation', { name: copy.Notes, exact: true })
        .locator('a[href="' + new URL(lectureUrl).pathname + '"]')
        .click();
      await expect(page).toHaveURL(lectureUrl);
      await expect(body).toHaveText(content);
      await page.reload();
      await expect(body).toHaveText(content);
      expect(secondUrl).not.toBe(page.url());
    }

    await notebook.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    await expect(editor).toHaveValue(content);
    await editor.press('Control+End');
    await editor.press('Home');

    // Conclusion plus 26 upward lines places the corrected middle sentinel in the editor.
    for (let line = 0; line < 29; line++) await editor.press('ArrowUp');

    await expect(editor).toHaveJSProperty('selectionStart', content.indexOf('record(25,'));
    await expect(editor).toBeFocused();
    await fullyVisible({ expect }, editor);
    await fullyVisible({ expect }, dialog.getByRole('button', { name: copy.NoteSaveNote }));
    await expectScreenshot('edited-reopened', {
      target: dialog,
      ready: () => expect(editor).toHaveValue(content)
    });
  }
);
