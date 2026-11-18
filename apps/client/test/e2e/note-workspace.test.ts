import { Language, StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.browser.use({ aiEnabled: true, video: { mode: 'on', size: { width: 2560, height: 1440 } } });

const copy = catalogs.english;

const first = 'Mitosis preserves chromosome number and produces two daughter cells.';

const second = 'DNA is copied before cell division. Chromosomes carry genetic information.';

const revised =
  'Before mitosis, DNA is copied. Each daughter cell receives the same chromosome number.';

test.browser.stable(
  'Knowledge dump section titles and study document middle states',
  async ({ page, study, expectScreenshot, expect }) => {
    const fixture = await study.notes.seed();
    const url = `/notes/${fixture.note.id}`;

    await page.goto(url);
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const outline = page.getByRole('navigation', { name: copy.NoteOutline });
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const add = page.getByRole('button', { name: copy.NoteAddCapture, exact: true });

    await expectScreenshot('empty-named-dump', {
      target: 'viewport',
      ready: () => expect(add).toBeVisible()
    });
    await add.click();
    await composer.fill(first);
    await expectScreenshot('first-capture-draft', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(first)
    });
    const initial = study.notes.capture(first, 'Mitosis and daughter cells');

    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await Promise.all([initial.classification.called, initial.naming.called]);
    await expectScreenshot('first-title-pending-fallback', {
      target: 'viewport',
      ready: async () => {
        await expect(notebook.locator('.chat-message-text')).toHaveText(first);
        await expect(composer).toBeHidden();
        await expect(outline.getByRole('button')).toContainText('Mitosis preserves');
        await expect(
          notebook.getByRole('heading', { name: 'Mitosis and daughter cells' })
        ).toHaveCount(0);
      }
    });
    initial.naming.release();
    await expectScreenshot('first-title-published', {
      target: 'viewport',
      ready: async () => {
        await expect(
          notebook.getByRole('heading', { name: 'Mitosis and daughter cells' })
        ).toBeVisible();
        await expect(
          outline.getByRole('button', { name: 'Mitosis and daughter cells' })
        ).toBeVisible();
      }
    });
    await add.click();
    await composer.fill(second);
    const following = study.notes.capture(second, 'DNA before division');

    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await Promise.all([following.classification.called, following.naming.called]);
    await expectScreenshot('second-title-pending', {
      target: 'viewport',
      ready: async () => {
        await expect(notebook.locator('.chat-message-text')).toHaveText([first, second]);
        await expect(outline.getByRole('button')).toHaveCount(2);
      }
    });
    following.naming.release();
    await expect(outline.getByRole('button', { name: 'DNA before division' })).toBeVisible();
    await outline.getByRole('button', { name: 'Mitosis and daughter cells' }).focus();
    await page.keyboard.press('Enter');
    await expectScreenshot('outline-selected-keyboard-target', {
      target: 'viewport',
      focus: 'preserve',
      ready: async () => {
        await expect(
          outline.getByRole('button', { name: 'Mitosis and daughter cells' })
        ).toHaveAttribute('aria-current', 'location');
        await expect(notebook.locator('.note-index-target').first()).toBeFocused();
      }
    });
    const capture = notebook.locator('[data-role="user"]').first();

    await capture.hover();
    await capture.getByRole('button', { name: copy.NoteEditNote }).click();
    const edit = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = edit.getByRole('textbox', { name: copy.NoteEditNote });

    await editor.fill(revised);
    await expectScreenshot('edit-capture-draft', {
      target: edit,
      ready: () => expect(editor).toHaveValue(revised)
    });
    const replacement = study.notes.capture(revised, 'DNA copying and inheritance');

    await edit.getByRole('button', { name: copy.NoteSaveNote }).click();
    await Promise.all([replacement.classification.called, replacement.naming.called]);
    await expectScreenshot('edited-title-pending-stale-hidden', {
      target: 'viewport',
      ready: async () => {
        await expect(edit).toBeHidden();
        await expect(notebook.locator('.chat-message-text').first()).toHaveText(revised);
        await expect(outline.getByRole('button').first()).toContainText('Before mitosis');
        await expect(page.getByRole('heading', { name: 'Mitosis and daughter cells' })).toHaveCount(
          0
        );
      }
    });
    replacement.naming.release();
    await expect(
      notebook.getByRole('heading', { name: 'DNA copying and inheritance' })
    ).toBeVisible();
    await page.reload();
    await expectScreenshot('reopened-generated-titles', {
      target: 'viewport',
      ready: async () => {
        await expect(notebook.locator('.chat-message-text')).toHaveText([revised, second]);
        await expect(
          outline.getByRole('button', { name: 'DNA copying and inheritance' })
        ).toBeVisible();
        await expect(outline.getByRole('button', { name: 'DNA before division' })).toBeVisible();
      }
    });
    await page.getByRole('button', { name: copy.NoteTransform, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteTransform });
    const title = 'Cell division study guide';
    const instruction = 'Organize the observations for revision. Preserve the original claims.';

    await dialog.getByRole('textbox', { name: copy.NoteOutputTitle }).fill(title);
    await dialog.getByRole('textbox', { name: copy.NoteInstructions }).fill(instruction);
    await expectScreenshot('transform-context-and-instructions', {
      target: dialog,
      ready: () =>
        expect(dialog.getByRole('textbox', { name: copy.NoteOutputTitle })).toHaveValue(title)
    });
    await dialog.getByText(copy.PageAdvancedOptions, { exact: true }).click();
    await dialog.getByRole('button', { name: copy.NoteOpStructure, exact: true }).click();
    await expectScreenshot('transform-operations-selected', {
      target: dialog,
      ready: () =>
        expect(
          dialog.getByRole('button', { name: copy.NoteOpStructure, exact: true })
        ).toHaveAttribute('aria-pressed', 'true')
    });
    const transform = await study.notes.transform(fixture.note.id, {
      title,
      instruction,
      operations: ['clarity', 'structure']
    });
    const failure = transform.fail(
      new StudyError('invalid_input', 'Controlled transformation output rejection')
    );

    await dialog.getByRole('button', { name: copy.NoteCreatePage, exact: true }).click();
    await failure.called;
    await expectScreenshot('transform-generation-running', {
      target: 'viewport',
      ready: async () => {
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole('button', {
            name: copy.NoteWorkStop.replace('{title}', title),
            exact: true
          })
        ).toBeVisible();
        await expect(notebook.locator('.chat-message-text')).toHaveText([revised, second]);
      }
    });
    failure.release();
    await page.getByRole('button', { name: copy.NoteTransform, exact: true }).click();
    await expectScreenshot('transform-generation-failed', {
      target: 'viewport',
      ready: () => expect(page.getByRole('button', { name: copy.Retry, exact: true })).toBeVisible()
    });
    const generated = transform.next({
      blocks: [
        {
          type: 'heading',
          level: 1,
          inlines: [{ type: 'text', text: 'Cell division', marks: [] }]
        },
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'text',
              text: 'DNA is copied before mitosis. Each daughter cell receives the same chromosome number.',
              marks: []
            }
          ]
        },
        {
          type: 'paragraph',
          inlines: [{ type: 'text', text: 'Chromosomes carry genetic information.', marks: [] }]
        }
      ],
      notes: [
        {
          kind: 'limit',
          explanation:
            'Organized only the captured observations; factual verification was not performed.',
          blockOrdinals: []
        }
      ]
    });

    await page.getByRole('button', { name: copy.Retry, exact: true }).click();
    await generated.called;
    await expectScreenshot('transform-retry-running', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('button', { name: copy.NoteCancel, exact: true })).toBeVisible()
    });
    generated.release();
    await expectScreenshot('transform-output-published-raw-preserved', {
      target: 'viewport',
      ready: async () => {
        await expect(page.getByRole('link', { name: copy.NoteOpenOutput })).toBeVisible();
        await expect(notebook.locator('.chat-message-text')).toHaveText([revised, second]);
      }
    });
    await page.getByRole('link', { name: copy.NoteOpenOutput }).click();
    await expect(page).toHaveURL(/\/pages\//);
    const pageEditor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await expectScreenshot('generated-study-page', {
      target: 'viewport',
      ready: async () => {
        await expect(pageEditor).toHaveAttribute('contenteditable', 'true');
        await expect(pageEditor).toContainText('DNA is copied before mitosis.');
      }
    });
    await pageEditor.focus();
    await expect(pageEditor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+End');
    // The toolbar reflects the editor's selection after the browser moves its native caret.
    await expect(
      page.getByRole('button', {
        name: `${copy.NoteFormatStyle}: ${copy.NoteFormatParagraph}`,
        exact: true
      })
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(pageEditor.locator('p')).toHaveCount(3);
    await expect(pageEditor.locator('p').last()).toHaveText('');
    await expect(pageEditor).toBeFocused();
    await page.keyboard.type('Study reminder: review chromosome inheritance.');
    await expectScreenshot('generated-page-editable', {
      target: 'viewport',
      ready: async () => {
        await expect(pageEditor.locator('p').last()).toHaveText(
          'Study reminder: review chromosome inheritance.'
        );
        await expect(pageEditor.getByRole('heading', { level: 1 })).toHaveText('Cell division');
        await expect(page.getByText(copy.NoteAutosaved, { exact: true })).toBeVisible();
      }
    });
    await page.goto(url);
    await study.settings({ language: Language.ITALIAN });
    await page.reload();
    await expectScreenshot('italian-dump-with-generated-titles', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('navigation', { name: catalogs.italian.NoteOutline })
        ).toBeVisible();
        await expect(
          page
            .getByRole('region', { name: catalogs.italian.NoteNotebook })
            .locator('.chat-message-text')
        ).toHaveText([revised, second]);
      }
    });
  }
);

test.browser.stable(
  'Knowledge dump transformation cancellation preserves captures',
  async ({ page, study, expectScreenshot, expect }) => {
    const fixture = await study.notes.seed();
    const capture = study.notes.capture(first, 'Mitosis and daughter cells');

    await page.goto(`/notes/${fixture.note.id}`);
    await page.getByRole('button', { name: copy.NoteAddCapture, exact: true }).click();
    await page.getByRole('textbox', { name: copy.NoteCompose }).fill(first);
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await Promise.all([capture.classification.called, capture.naming.called]);
    capture.naming.release();
    await expect(page.getByRole('heading', { name: 'Mitosis and daughter cells' })).toBeVisible();
    await page.getByRole('button', { name: copy.NoteTransform, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteTransform });
    const title = 'Cancelled study guide';

    await dialog.getByRole('textbox', { name: copy.NoteOutputTitle }).fill(title);
    const transform = await study.notes.transform(fixture.note.id, {
      title,
      instruction: '',
      operations: ['clarity']
    });
    const held = transform.next({
      blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text: first, marks: [] }] }],
      notes: [
        {
          kind: 'limit',
          explanation: 'Captured notes only; no factual verification.',
          blockOrdinals: []
        }
      ]
    });

    await dialog.getByRole('button', { name: copy.NoteCreatePage, exact: true }).click();
    await held.called;
    await expectScreenshot('cancellable-transform-running', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', {
            name: copy.NoteWorkStop.replace('{title}', title),
            exact: true
          })
        ).toBeVisible()
    });
    await page
      .getByRole('button', { name: copy.NoteWorkStop.replace('{title}', title), exact: true })
      .click();
    await page.getByRole('button', { name: copy.NoteTransform, exact: true }).click();
    await expectScreenshot('transform-cancelled-raw-preserved', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('status').filter({ hasText: copy.NoteCancelledTransform })
        ).toBeVisible();
        await expect(page.locator('.chat-message-text')).toHaveText(first);
        await expect(page.getByRole('link', { name: copy.NoteOpenOutput })).toHaveCount(0);
      }
    });
    held.release();
    await page.reload();
    await page.getByRole('button', { name: copy.NoteTransform, exact: true }).click();
    await expectScreenshot('cancelled-transform-reopened', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('status').filter({ hasText: copy.NoteCancelledTransform })
        ).toBeVisible();
        await expect(page.locator('.chat-message-text')).toHaveText(first);
        await expect(
          page.getByRole('heading', { name: 'Mitosis and daughter cells' })
        ).toBeVisible();
      }
    });
  }
);
