import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({
  aiEnabled: true,
  video: 'on',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true
});

test.browser.stable(
  'Phone notebook history keeps section headings and actions together',
  async ({ page, study, rpc, expect, expectScreenshot }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));
    const fixture = await study.notes.seed();

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

      await rpc.runPromise(rpc.client['notes.postMessage']({ noteId: fixture.note.id, text }));
      await pending.naming.called;
      pending.naming.release();
    }

    await page.goto(`/notes/${fixture.note.id}`);
    await page.getByRole('button', { name: copy.NoteActions, exact: true }).tap();
    await page.getByRole('button', { name: copy.NoteHistory, exact: true }).tap();

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
    await heading.tap();
    await expect(more).not.toBeFocused();
    await expect(first.locator('.chat-message-actions-toggle:hover')).toHaveCount(0);
    await expectScreenshot('narrow-section-reading', {
      target: 'viewport',
      zoomPercent: 100,
      scrollToEnd: page.locator('[data-notebook-scroll-host]'),
      ready: async () => {
        await expect(heading).toBeInViewport();
        await expect(
          page.getByRole('button', { name: copy.JumpToLatest, exact: true })
        ).toBeHidden();
      }
    });
  }
);
