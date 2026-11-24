import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Flashcard review saves ratings and offers replay after reload',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Earth science' })
    );
    const title = 'Rock cycle recall';
    const first = {
      front: 'What forms when magma cools?',
      back: 'Igneous rock.'
    };
    const second = {
      front: 'What changes rock without melting it?',
      back: 'Heat and pressure.'
    };

    const { version } = await rpc.runPromise(
      rpc.client['materials.create']({
        projectId: project.id,
        title,
        content: { kind: 'flashcards', cards: [first, second] }
      })
    );

    if (version.kind !== 'flashcards') throw new Error('Expected a flashcard deck');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/practice?project=${project.id}`);
    const sidebar = page.getByRole('complementary', { name: copy.SidebarNavigation });

    await sidebar.getByRole('link', { name: title }).click();
    const main = page.getByRole('main');
    const firstPrompt = main.getByRole('heading', { name: first.front, exact: true });
    const firstAnswer = main.getByText(first.back, { exact: true });
    const secondAnswer = main.getByText(second.back, { exact: true });
    const showAnswer = main.getByRole('button', { name: copy.ShowAnswer, exact: true });

    await expect(firstPrompt).toBeVisible();
    await expect(firstAnswer).toBeHidden();
    await main.locator('.study-practice-active').focus();
    await page.keyboard.press('Space');
    await expect(firstAnswer).toBeVisible();
    await page.keyboard.press('3');

    await expect(main.getByRole('heading', { name: second.front, exact: true })).toBeVisible();
    await expect(secondAnswer).toBeHidden();
    await showAnswer.click();
    await expect(secondAnswer).toBeVisible();
    await main.getByRole('button', { name: copy.RateEasy, exact: true }).click();

    const caughtUp = main.getByRole('heading', { name: copy.PracticeNothingDue, exact: true });
    const complete = main.getByRole('heading', { name: copy.PracticeReviewComplete, exact: true });

    await expect(complete.or(caughtUp)).toBeVisible();
    await page.reload();
    await expect(caughtUp).toBeVisible();
    const history = await Promise.all(
      version.content.cards.map(({ cardId }) =>
        rpc.runPromise(
          rpc.client['learning.reviewHistory']({ versionId: version.id, cardId, limit: 10 })
        )
      )
    );

    expect(history.map(({ items }) => items.map(({ review }) => review.rating))).toEqual([
      ['good'],
      ['easy']
    ]);
    await expectScreenshot('caught-up', {
      target: 'viewport',
      ready: () => expect(caughtUp).toBeVisible()
    });
    await main.getByRole('button', { name: copy.PracticeReplayFlashcards, exact: true }).click();
    await expect(firstPrompt).toBeVisible();
    await expect(firstAnswer).toBeHidden();
    await expect(showAnswer).toBeVisible();
  }
);
