import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({
  aiEnabled: true,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true
});

test.browser.stable(
  'Phone section headings keep reading and actions together',
  async ({ page, study, rpc, expect, expectScreenshot }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));
    const fixture = await study.notes.seed();

    await page.goto(`/notes/${fixture.note.id}`);

    for (const [text, title] of [
      [
        'Retrieving a memory strengthens it. Rereading can feel familiar without lasting recall.',
        'Retrieval practice'
      ],
      [
        'Distribute practice across several days and compare what you can recall each time.',
        'Spacing practice across several days improves long-term recall'
      ],
      ['Compare active recall with rereading before the next seminar.', 'Active recall comparison']
    ] as const) {
      const pending = study.notes.capture(text, title);

      await page.getByRole('button', { name: copy.NoteAddCapture, exact: true }).tap();
      await page.getByRole('textbox', { name: copy.NoteCompose }).fill(text);
      await page.getByRole('button', { name: copy.NoteSaveNote, exact: true }).tap();
      await pending.naming.called;
      pending.naming.release();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }

    const first = page.locator('.chat-message').first();
    const heading = first.getByRole('heading');
    const more = first.getByRole('button', { name: copy.NoteItemActions, exact: true });

    await heading.scrollIntoViewIfNeeded();
    await expectScreenshot('section-reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(more).toHaveAttribute('aria-expanded', 'false')
    });
    await more.tap();
    await expectScreenshot('section-actions', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(first.getByRole('button', { name: copy.NoteDeleteItem })).toBeVisible()
    });
    await more.tap();
    await page.setViewportSize({ width: 320, height: 640 });
    await expectScreenshot('narrow-section-reading', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(heading).toBeInViewport()
    });
    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 125 }));
    await page.reload();
    await expectScreenshot('enlarged-section-reading', {
      target: 'viewport',
      zoomPercent: 125,
      ready: () => expect(heading).toBeVisible()
    });
  }
);
