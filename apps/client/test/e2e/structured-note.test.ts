import { Appearance, Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

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
  async ({ page, rpc, expectScreenshot, expect, study }) => {
    const preferences = await rpc.runPromise(rpc.client['settings.workspacePreferences']({}));

    await rpc.runPromise(
      rpc.client['settings.saveWorkspacePreferences']({
        ...preferences,
        autosaveIntervalSeconds: 1
      })
    );

    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: original, notebookBody: true }
      })
    );

    await page.goto(`/notes/${note.id}`);
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const title = editor.getByRole('heading', { name: 'River systems lecture', level: 1 });
    const table = editor.getByRole('table');
    const codeBlock = editor.locator('pre > code');

    await expect(title).toBeVisible();
    await expect(editor.locator('strong')).toHaveText('calibrated gauge');
    await expect(editor.locator('em')).toHaveText('independent reading');
    await expect(editor.getByText('riverStage', { exact: true })).toHaveJSProperty(
      'tagName',
      'CODE'
    );
    await expect(editor.locator('ul ul ul li')).toHaveText('Record the calibration');
    await expect(editor.locator('ol > li')).toHaveText([
      'Prepare the samples',
      'Compare the readings',
      'Retain the evidence'
    ]);
    await expect(editor.locator('blockquote')).toHaveText(
      'Preserve the original observation before drawing a conclusion.'
    );
    await expect(editor.getByRole('link', { name: 'Lecture reference' })).toHaveAttribute(
      'href',
      /https:\/\/example\.invalid\/lecture\/.*end$/
    );
    await expect(table.getByRole('columnheader')).toHaveCount(5);
    await expect(table.getByRole('cell').last()).toHaveText('TABLE-END');
    await expect(codeBlock).toHaveJSProperty('textContent', code);

    await study.settings({ appearance: Appearance.DARK, zoomPercent: 100 });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.reload();
    await expectScreenshot('desktop-dark-reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(title).toBeInViewport()
    });

    const conclusion = editor.getByText(/^END-OF-LECTURE:/);

    await conclusion.click();
    await editor.press('End');
    await page.keyboard.insertText(' Verified in the field.');
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    await study.settings({ language: Language.ITALIAN, appearance: Appearance.LIGHT });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const italian = catalogs.italian;
    const localized = page.getByRole('textbox', { name: italian.NotePageEditor, exact: true });
    const updated = localized.getByText(/Verified in the field\./);

    await expect(localized.getByRole('table')).toBeVisible();
    await expect(localized.locator('pre > code')).toHaveJSProperty('textContent', code);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
    await updated.scrollIntoViewIfNeeded();
    await expectScreenshot('phone-light-reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(updated).toBeInViewport()
    });
  }
);
