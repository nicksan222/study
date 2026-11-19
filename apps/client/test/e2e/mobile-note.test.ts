import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { Locator } from 'playwright';

const copy = catalogs.english;

async function expectSeparateControls(
  { expect }: Pick<test.browser.Context, 'expect'>,
  first: Locator,
  second: Locator
) {
  await expect(second).toBeVisible();
  await expect
    .poll(async () => {
      if ((await first.count()) === 0) return true;

      const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);

      return (
        b !== null &&
        (!a ||
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y)
      );
    })
    .toBe(true);
}

test.browser.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.browser.stable(
  'Touch note editing keeps entry drafts and save reachable',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));
    const original =
      'River garden field notebook\n\nMorning survey: record the water level and inspect the wooden bridge.\n\nKeep the original observations so the next team can compare the results.';
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: original, sourceIds: [] }
      })
    );

    await page.goto('/notes/' + String(note.id));
    await expect(page.getByRole('button', { name: copy.ToggleSidebar })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const edit = page.getByRole('button', { name: copy.NoteEditNote });

    await expect(edit).toBeInViewport({ ratio: 1 });
    await edit.tap();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });

    await dialog.getByRole('button', { name: copy.NoteMarkdownSource, exact: true }).click();
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });
    const changed = original + '\n\nBridge inspection corrected on mobile.';

    await expect(editor).toHaveValue(original);
    await expect(editor).toHaveCSS('font-size', '16px');
    await editor.fill(changed);
    await dialog.getByRole('button', { name: copy.NoteBackToNotebook }).tap();
    await expect(dialog).toBeHidden();
    await expect(notebook.locator('.chat-message-text')).toHaveText(original);
    const resume = page.getByRole('button', { name: copy.NoteContinueEditing });

    await resume.scrollIntoViewIfNeeded();
    await expect(resume).toBeInViewport({ ratio: 1 });
    await expectScreenshot('paused-draft', {
      target: 'viewport',
      zoomPercent: 100,
      scrollToEnd: page.locator('[data-notebook-scroll-host]'),
      ready: () => expect(resume).toBeVisible()
    });
    await resume.tap();
    await expect(editor).toHaveValue(changed);
    await page.setViewportSize({ width: 390, height: 520 });
    await expect(dialog).toHaveCSS('translate', '0px');
    const save = dialog.getByRole('button', { name: copy.NoteSaveNote });

    await expect(save).toBeInViewport({ ratio: 1 });
    await expectAccessibility('touch-note-editor');
    await expectScreenshot('short-viewport-editor', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(editor).toHaveValue(changed)
    });
    await save.tap();
    await expect(dialog).toBeHidden();
    await expect(notebook.locator('.chat-message-text')).toHaveText(changed);
    await page.reload();
    await expect(notebook.locator('.chat-message-text')).toHaveText(changed);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: copy.ToggleSidebar })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    const add = page.getByRole('button', { name: copy.NoteAddCapture, exact: true });
    const capture = page.getByRole('textbox', { name: copy.NoteCompose });

    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeInViewport({ ratio: 1 });
    await expectScreenshot('saved-capture-collapsed', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(add).toHaveAttribute('aria-expanded', 'false')
    });
    await add.tap();
    await capture.fill('Next mobile observation: compare the northern bank.');
    await expectSeparateControls(
      { expect },
      page.getByRole('button', { name: copy.JumpToLatest, exact: true }),
      page.locator('.workspace-desk-capture .ui-composer-footer')
    );
    await expectScreenshot('mobile-capture-draft', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () =>
        expect(capture).toHaveValue('Next mobile observation: compare the northern bank.')
    });
    await page.getByRole('button', { name: copy.NoteHideCapture, exact: true }).tap();
    await expect(capture).toBeHidden();
    await expectScreenshot('mobile-capture-closed', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(add).toHaveAttribute('aria-expanded', 'false')
    });
    await add.tap();
    await expect(capture).toHaveValue('Next mobile observation: compare the northern bank.');
    await page.getByRole('button', { name: copy.NoteSaveNote, exact: true }).tap();
    await expect(notebook.locator('.chat-message-text')).toHaveText([
      changed,
      'Next mobile observation: compare the northern bank.'
    ]);

    for (const entry of await notebook.locator('[data-role="user"]').all()) {
      await expectSeparateControls(
        { expect },
        entry.locator('.chat-message-actions'),
        entry.locator('.chat-message-text')
      );
    }

    await expectScreenshot('mobile-capture-saved', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(add).toHaveAttribute('aria-expanded', 'false')
    });
  }
);

test.browser.stable(
  'Phone notebook keeps reading and secondary actions compact at default scale',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));
    const text =
      'River garden\n\nThe morning survey follows the shaded bank. Keep the measurements beside the original observations.';
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({ initialMessage: { text, sourceIds: [] } })
    );

    await page.goto('/notes/' + String(note.id));
    const context = page.getByRole('button', { name: copy.NoteActions, exact: true });
    const actions = page.getByRole('button', { name: copy.NoteItemActions, exact: true });
    const body = page.locator('.chat-message-text');

    await expect(body).toHaveText(text);
    await expect(context).toHaveAttribute('aria-expanded', 'false');
    await expect(actions).toHaveAttribute('aria-expanded', 'false');
    await expectScreenshot('reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(actions).toHaveAttribute('aria-expanded', 'false')
    });
    await actions.tap();
    await expect(
      page.getByRole('button', { name: copy.NoteDeleteItem, exact: true })
    ).toBeVisible();
    await expectScreenshot('entry-actions', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(actions).toHaveAttribute('aria-expanded', 'true')
    });
    await page.getByRole('button', { name: copy.NoteAiAvailability }).tap();
    const availability = page.getByRole('dialog', { name: copy.NoteAiAvailability });

    await expect(availability.getByRole('link', { name: copy.Settings })).toBeEnabled();
    await expectScreenshot('ai-availability', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(availability).toContainText(copy.AiReadinessSetup)
    });
    await availability.getByRole('button', { name: copy.Close }).tap();
    await actions.tap();
    await context.tap();
    await expect(page.getByRole('navigation', { name: copy.NoteOutline })).toBeVisible();
    await expectScreenshot('outline-and-actions', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(page.getByRole('navigation', { name: copy.NoteOutline })).toBeVisible()
    });
    await context.tap();
    await page.getByRole('button', { name: copy.NoteAssistantOpen, exact: true }).tap();
    await expect(page.getByRole('button', { name: copy.NoteDockBelow })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.NoteDockBeside })).toHaveCount(0);
    const back = page.getByRole('button', { name: copy.NoteBackToBoard, exact: true });

    await expectScreenshot('assistant-panel', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(back).toBeVisible()
    });
    await back.tap();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByRole('button', { name: copy.NoteAddCapture, exact: true }).tap();
    const capture = page.getByRole('textbox', { name: copy.NoteCompose });

    await capture.fill('A quick thought to revisit beside the river.');
    await expect(page.getByRole('button', { name: copy.NoteSaveNote, exact: true })).toBeInViewport(
      { ratio: 1 }
    );
    await expectScreenshot('narrow-capture', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(capture).toHaveValue('A quick thought to revisit beside the river.')
    });
    await page.getByRole('button', { name: copy.NoteHideCapture, exact: true }).tap();
    await page.getByRole('button', { name: copy.NoteEditNote, exact: true }).tap();
    await page.setViewportSize({ width: 320, height: 520 });
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });

    const visual = dialog.getByRole('textbox', { name: copy.NoteEditNote });
    const paragraphs = visual.locator('p');

    await expect(visual).toHaveAttribute('contenteditable', 'true');
    await expect(paragraphs).toHaveText(text.split('\n\n'));
    await expect(
      dialog.getByRole('button', { name: copy.NoteSaveNote, exact: true })
    ).toBeInViewport({ ratio: 1 });
    await expectAccessibility('default-phone-editor');
    await expectScreenshot('narrow-short-editor', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(paragraphs).toHaveText(text.split('\n\n'))
    });
  }
);

async function phoneStarter({
  page,
  rpc,
  expect,
  expectScreenshot
}: Pick<test.browser.Context, 'page' | 'rpc' | 'expect' | 'expectScreenshot'>) {
  const zoomPercent = 100;
  const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

  await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent }));
  await page.goto('/notes');
  const capture = page.getByRole('textbox', { name: copy.NoteCompose });
  const context = page.getByRole('button', { name: copy.NoteActions, exact: true });
  const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });

  await expect(capture).toBeVisible();
  await expect(capture).toHaveCSS('font-size', '16px');
  await expect(context).toHaveAttribute('aria-expanded', 'false');
  await expect(save).toBeDisabled();
  await expectScreenshot('empty-starter', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(capture).toHaveValue('')
  });
  await capture.fill(
    'River garden: collect the field notes and survey source before shaping a study document.'
  );
  await expect(capture).toHaveCSS('font-size', '16px');
  await expectScreenshot('starter-draft', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(save).toBeEnabled()
  });
  await page.getByLabel(copy.NoteAttachFiles, { exact: true }).setInputFiles({
    name: 'river-survey.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# River survey\n\nThe shaded bank has twelve willows.')
  });
  await expect(
    page
      .getByRole('region', { name: copy.NoteCompose, exact: true })
      .getByText('river-survey.md', { exact: true })
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(save).toBeInViewport({ ratio: 1 });
  await expectScreenshot('narrow-staged-file', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(save).toBeEnabled()
  });
  await save.tap();
  await expect(page).toHaveURL(/\/notes\/.+/);
  await expect(capture).toBeHidden();
  const source = page
    .locator('[data-role="user"]')
    .getByRole('button', { name: 'river-survey.md', exact: true });

  await expect(source).toBeEnabled();
  await expectScreenshot('saved-file', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(source).toBeEnabled()
  });
  await source.tap();
  await expect(page.getByRole('heading', { name: 'River survey', exact: true })).toBeVisible();
  await expectScreenshot('source-preview', {
    target: 'viewport',
    zoomPercent,
    ready: () =>
      expect(page.getByRole('heading', { name: 'River survey', exact: true })).toBeVisible()
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: copy.NoteAddCapture, exact: true }).tap();
  const lecture = Array.from(
    { length: 20 },
    (_, i) =>
      `Observation ${i + 1}: compare the water level, preserve the evidence and revisit the shaded bank.`
  ).join('\n\n');

  await capture.fill(lecture);
  await save.tap();
  const entries = page.locator('.chat-message-text');

  await expect(entries).toHaveCount(2);
  await expect(entries.last()).toHaveText(lecture);
  await expectScreenshot('long-lecture-bottom', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(entries.last()).toHaveText(lecture)
  });
  const readingPosition = await entries.last().boundingBox();
  const viewportBounds = await page.locator('[data-notebook-scroll-host]').boundingBox();

  expect(viewportBounds).not.toBeNull();
  expect(viewportBounds!.y).toBeGreaterThanOrEqual(0);
  expect(viewportBounds!.y + viewportBounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height
  );

  await context.tap();
  await expect(page.getByRole('button', { name: copy.NoteTransform, exact: true })).toBeInViewport({
    ratio: 1
  });
  await expectScreenshot('context-from-long-lecture', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(context).toHaveAttribute('aria-expanded', 'true')
  });
  await context.tap();
  expect(await page.locator('[data-notebook-scroll-host]').boundingBox()).toEqual(viewportBounds);
  await expect.poll(async () => (await entries.last().boundingBox())?.y).toBe(readingPosition?.y);
  await context.tap();
  const outline = page.getByRole('navigation', { name: copy.NoteOutline });

  await expect(outline.getByRole('button')).toHaveCount(2);
  await outline.getByRole('button').last().tap();
  await expect(context).toHaveAttribute('aria-expanded', 'false');
  await expectScreenshot('long-lecture-start', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(entries.last()).toHaveVisibleText('Observation 1:')
  });
  await context.tap();
  await page.getByRole('button', { name: copy.NoteTransform, exact: true }).tap();
  await page.setViewportSize({ width: 320, height: 520 });
  const dialog = page.getByRole('dialog', { name: copy.NoteTransform });
  const title = dialog.getByRole('textbox', { name: copy.NoteOutputTitle });
  const instruction = dialog.getByRole('textbox', { name: copy.NoteInstructions });

  await title.fill('River survey study guide');
  await instruction.fill('Organize the observations while preserving the original evidence.');
  await expect(instruction).toHaveCSS('font-size', '16px');
  await expectScreenshot('transform-setup', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(title).toHaveValue('River survey study guide')
  });
  const generate = dialog.getByRole('button', { name: copy.NoteCreatePage, exact: true });

  await generate.scrollIntoViewIfNeeded();
  await expect(generate).toBeInViewport({ ratio: 1 });
  await expect(generate).toBeDisabled();
  await expect(
    dialog.locator('.ui-action-tooltip').filter({ hasText: copy.NoteCreatePage })
  ).toHaveVisibleText(copy.NoteCreatePage);
  await expect(
    dialog.getByRole('button', { name: copy.Close, exact: true }).filter({ hasText: copy.Close })
  ).toBeInViewport({
    ratio: 1
  });
  const bounds = await dialog.boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);

  return generate;
}

test.browser.stable(
  'Phone starter collects text and files at 100 percent',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const generate = await phoneStarter({ page, rpc, expect, expectScreenshot });

    await expectScreenshot('transform-lower-form', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(generate).toBeDisabled()
    });
  }
);
