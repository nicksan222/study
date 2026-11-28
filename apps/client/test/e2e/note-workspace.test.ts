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
  async ({ page, rpc, study, expectScreenshot, expect }) => {
    const fixture = await study.notes.seed();
    const url = `/notes/${fixture.note.id}`;

    await page.goto(url);
    const body = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await expectScreenshot('empty-named-dump', {
      target: 'viewport',
      ready: () => expect(body).toHaveText('')
    });
    await openHistory(page, copy);
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const outline = page.getByRole('navigation', { name: copy.NoteOutline });
    const initial = study.notes.capture(first, 'Mitosis and daughter cells');

    await rpc.runPromise(rpc.client['notes.postMessage']({ noteId: fixture.note.id, text: first }));
    await Promise.all([initial.classification.called, initial.naming.called]);
    await expectScreenshot('first-title-pending-fallback', {
      target: 'viewport',
      ready: async () => {
        await expect(notebook.locator('.chat-message-text')).toHaveText(first);
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
    const following = study.notes.capture(second, 'DNA before division');

    await rpc.runPromise(
      rpc.client['notes.postMessage']({ noteId: fixture.note.id, text: second })
    );
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

    await edit.getByRole('button', { name: copy.NoteMarkdownSource, exact: true }).click();
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
    await openHistory(page, copy);
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
    await expect(page.getByRole('button', { name: copy.NoteTransform, exact: true })).toHaveCount(
      0
    );
    await page.goto(`/projects/${fixture.project.id}/uploads`);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'lab-results.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Lab counts: each daughter cell had the same number of chromosomes.')
    });
    await page.getByRole('link', { name: 'lab-results.txt', exact: true }).click();
    await expect(page.locator('[data-materials-reader]').getByText(/Lab counts/)).toBeVisible();
    await page.goto(`/practice?project=${fixture.project.id}`);
    const dialog = await openStudyNotes(page);

    await dialog.getByRole('switch', { name: 'Cell division research dump' }).click();
    await dialog.getByRole('switch', { name: /lab-results/ }).click();
    await dialog.getByText(copy.PracticeCustomize, { exact: true }).click();
    const instruction = 'Organize the observations for revision. Preserve the original claims.';

    const title = 'Study notes for the cell division exam';

    await dialog.getByRole('textbox', { name: copy.PracticeStudyNotesCustomTitle }).fill(title);
    await dialog.getByRole('textbox', { name: copy.PracticeGeneratePrompt }).fill(instruction);
    await expectScreenshot('transform-context-and-instructions', {
      target: dialog,
      ready: async () => {
        await expect(
          dialog.getByRole('switch', { name: 'Cell division research dump' })
        ).toBeChecked();
        await expect(dialog.getByRole('switch', { name: /lab-results/ })).toBeChecked();
      }
    });
    await dialog.getByRole('switch', { name: /lab-results/ }).click();
    const transform = await study.notes.studyNotes(
      fixture.note.id,
      fixture.project.id,
      title,
      instruction
    );
    const failure = transform.fail(
      new StudyError('invalid_input', 'Controlled transformation output rejection')
    );

    await dialog.getByRole('button', { name: copy.PracticeGenerateStart, exact: true }).click();
    await failure.called;
    await expectScreenshot('transform-generation-running', {
      target: 'viewport',
      ready: async () => {
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('button', { name: copy.Cancel })).toBeVisible();
      }
    });
    failure.release();
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
        expect(page.getByRole('button', { name: copy.Cancel, exact: true })).toBeVisible()
    });
    generated.release();
    await expectScreenshot('transform-output-published-raw-preserved', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('link', { name: copy.PracticeOpenStudyNotes })).toBeVisible()
    });
    await page.getByRole('link', { name: copy.PracticeOpenStudyNotes }).click();
    await expect(page).toHaveURL(/\/practice\/study-notes\//);
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
    await openHistory(page, catalogs.italian);
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

    await page.goto(`/notes/${fixture.note.id}`);
    const body = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await body.fill(first);
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
    const practice = `/practice?project=${fixture.project.id}`;

    await page.goto(practice);
    const dialog = await openStudyNotes(page);

    await dialog.getByRole('switch', { name: 'Cell division research dump' }).click();
    const transform = await study.notes.studyNotes(
      fixture.note.id,
      fixture.project.id,
      copy.PracticeStudyNotesTitle,
      ''
    );
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

    await dialog.getByRole('button', { name: copy.PracticeGenerateStart, exact: true }).click();
    await held.called;
    const cancel = page.getByRole('button', { name: copy.Cancel, exact: true });

    await expectScreenshot('cancellable-transform-running', {
      target: 'viewport',
      ready: () => expect(cancel).toBeVisible()
    });
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    held.release();
    await page.reload();
    await expect(page.getByRole('link', { name: copy.PracticeOpenStudyNotes })).toHaveCount(0);
    await page.goto(`/notes/${fixture.note.id}`);
    await expectScreenshot('cancelled-transform-reopened', {
      target: 'viewport',
      ready: () => expect(body).toHaveText(first)
    });
  }
);

async function openHistory(
  page: test.browser.Context['page'],
  language: Record<'NoteActions' | 'NoteHistory', string>
) {
  const context = page.getByRole('button', { name: language.NoteActions, exact: true });

  await context.click();
  await page.getByRole('button', { name: language.NoteHistory, exact: true }).click();
  await context.click();
}

async function openStudyNotes(page: test.browser.Context['page']) {
  await page.getByRole('button', { name: copy.PracticeGenerate, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.PracticeGenerate });

  await dialog.getByRole('radio', { name: copy.PracticeStudyNotes, exact: true }).click();

  return dialog;
}
