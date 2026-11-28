import { defaultQuizSettings, Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.browser.use({ video: { mode: 'on', size: { width: 1280, height: 900 } } });

const copy = catalogs.english;

async function checkFeedbackTiming(
  {
    page,
    rpc,
    expect,
    expectScreenshot,
    expectAccessibility
  }: Pick<
    test.browser.Context,
    'page' | 'rpc' | 'expect' | 'expectScreenshot' | 'expectAccessibility'
  >,
  timing: 'end' | 'immediate'
) {
  await page.goto('/notes');
  await page.getByRole('button', { name: copy.Settings, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.Settings });

  await dialog.getByRole('button', { name: copy.SettingsQuizzes, exact: true }).click();
  const feedback = dialog.getByRole('combobox', {
    name: copy.PracticeFeedbackTiming,
    exact: true
  });

  await expect(feedback).toHaveText(copy.PracticeFeedbackAtEnd);

  if (timing === 'immediate') {
    await feedback.click();
    await page.getByRole('option', { name: copy.PracticeFeedbackImmediately, exact: true }).click();
    await expect(feedback).toHaveText(copy.PracticeFeedbackImmediately);
    await expect(feedback).toBeEnabled();
  }

  await expectScreenshot('feedback-setting', {
    target: dialog,
    ready: () => expect(feedback).toBeEnabled()
  });
  await page.reload();
  const preferences = await rpc.runPromise(rpc.client['settings.quizSettings']({}));

  expect(preferences.feedbackTiming).toBe(timing);
  await rpc.runPromise(
    rpc.client['settings.saveQuizSettings']({ ...preferences, shuffleChoices: false })
  );
  const material = await rpc.runPromise(
    rpc.client['materials.create']({
      title: 'Practice feedback',
      content: {
        kind: 'quiz',
        questions: [
          {
            kind: 'true_false',
            prompt: 'Two is prime.',
            isTrue: true,
            explanation: 'Two has exactly two divisors.'
          },
          {
            kind: 'true_false',
            prompt: 'Four is prime.',
            isTrue: false,
            explanation: 'Four has three divisors.'
          }
        ]
      }
    })
  );

  await page.goto(`/practice/${material.id}`);
  await page.getByRole('button', { name: copy.PracticeStartQuiz }).click();
  await page.getByRole('radio', { name: copy.PracticeTrue, exact: false }).check();
  await page.getByRole('button', { name: copy.SubmitAnswer, exact: true }).click();

  if (timing === 'immediate') {
    await expect(page.getByRole('status').filter({ hasText: copy.VerdictCorrect })).toHaveText(
      copy.VerdictCorrect
    );
    await expect(
      page.getByRole('radio', {
        name: `${copy.PracticeTrue} ${copy.RightAnswer}`,
        exact: true
      })
    ).toBeDisabled();
    await expect(page.getByText('Two has exactly two divisors.', { exact: true })).toBeVisible();
    await expectScreenshot('immediate-correct', {
      target: 'viewport',
      ready: () =>
        expect(page.locator('.study-practice-choice[data-tone="correct"]')).toHaveCount(1)
    });
    await expectAccessibility('immediate-feedback');
    await page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true }).click();
  } else {
    await expect(page.getByText(copy.VerdictCorrect, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'Four is prime.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Four is prime.' })).toBeVisible();
  // Changing the preference must not change this attempt's captured mode.
  await rpc.runPromise(
    rpc.client['settings.saveQuizSettings']({
      ...defaultQuizSettings,
      feedbackTiming: timing === 'end' ? 'immediate' : 'end'
    })
  );
  await page.getByRole('radio', { name: copy.PracticeTrue, exact: false }).check();
  await page.getByRole('button', { name: copy.SubmitAnswer, exact: true }).click();

  if (timing === 'immediate') {
    await expect(page.getByRole('status').filter({ hasText: copy.VerdictIncorrect })).toHaveText(
      copy.VerdictIncorrect
    );
    await expect(
      page.getByRole('radio', { name: `${copy.PracticeTrue} ${copy.YourAnswer}`, exact: true })
    ).toBeChecked();
    await expect(
      page.getByRole('radio', {
        name: `${copy.PracticeFalse} ${copy.RightAnswer}`,
        exact: true
      })
    ).toBeDisabled();
    await expect(page.getByText('Four has three divisors.', { exact: true })).toBeVisible();
    const actions = page.getByRole('button', { name: copy.PracticeActions, exact: true });

    await expect(actions).toHaveAttribute('aria-expanded', 'true');
    await actions.click();
    await expect(actions).toHaveAttribute('aria-expanded', 'false');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectScreenshot('immediate-incorrect', {
      target: 'viewport',
      ready: () =>
        expect(page.locator('.study-practice-choice[data-tone="incorrect"]')).toHaveCount(1)
    });
    await expectAccessibility('incorrect-feedback');
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect(actions).toHaveAttribute('aria-expanded', 'false');
    await actions.click();
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true }).click();
  } else {
    await expect(page.getByText(copy.VerdictIncorrect, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true }).click();
  }

  await page.getByRole('button', { name: copy.PracticeFinishQuiz, exact: true }).click();
  await expect(page.getByText(/^50%/)).toBeVisible();
}

test.browser.stable(
  'Practice end feedback persists and controls answer verdicts',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    await checkFeedbackTiming({ page, rpc, expect, expectScreenshot, expectAccessibility }, 'end');
    await expectScreenshot('completed-feedback', {
      target: 'viewport',
      ready: () => expect(page.getByText(/^50%/)).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice immediate feedback persists and controls answer verdicts',
  async ({ page, rpc, expect, expectScreenshot, expectAccessibility }) => {
    await checkFeedbackTiming(
      { page, rpc, expect, expectScreenshot, expectAccessibility },
      'immediate'
    );
    await expectScreenshot('completed-feedback', {
      target: 'viewport',
      ready: () => expect(page.getByText(/^50%/)).toBeVisible()
    });
    const italian = catalogs.italian;
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
    );
    await page.reload();
    await page.getByRole('button', { name: italian.Settings, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: italian.Settings });

    await dialog.getByRole('button', { name: italian.SettingsQuizzes, exact: true }).click();
    await page.setViewportSize({ width: 800, height: 900 });
    const feedback = dialog.getByRole('combobox', {
      name: italian.PracticeFeedbackTiming,
      exact: true
    });

    await expect(feedback).toHaveText(italian.PracticeFeedbackAtEnd);
    await expect(feedback).toBeEnabled();
    await feedback.focus();
    await feedback.press('Enter');
    await page
      .getByRole('option', { name: italian.PracticeFeedbackImmediately, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(feedback).toHaveText(italian.PracticeFeedbackImmediately);
    await expect(feedback).toBeEnabled();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expectScreenshot('italian-feedback-setting', {
      target: dialog,
      ready: () => expect(feedback).toHaveText(italian.PracticeFeedbackImmediately)
    });
    await expectAccessibility('italian-feedback-setting');
  }
);

test.browser.stable(
  'Practice feedback preserves question and control geometry',
  async ({ page, rpc, expect, expectScreenshot }) => {
    await rpc.runPromise(
      rpc.client['settings.saveQuizSettings']({
        ...defaultQuizSettings,
        feedbackTiming: 'immediate',
        shuffleChoices: false
      })
    );
    const material = await rpc.runPromise(
      rpc.client['materials.create']({
        title: 'Stable practice',
        content: {
          kind: 'quiz',
          questions: [
            {
              kind: 'true_false',
              prompt: 'The cell membrane regulates what enters and leaves the cell.',
              isTrue: true,
              explanation: 'A selectively permeable membrane controls the passage of substances.'
            }
          ]
        }
      })
    );

    await page.goto(`/practice/${material.id}`);
    await page.getByRole('button', { name: copy.PracticeStartQuiz }).click();
    await page.getByRole('radio', { name: copy.PracticeTrue, exact: false }).check();
    const elements = page
      .locator('.study-practice-active')
      .locator(
        '.study-practice-prompt, .study-practice-answers, .study-practice-choice, .study-practice-stage-footer > button'
      );
    const before = await Promise.all(
      (await elements.all()).map((element) => element.boundingBox())
    );

    await page.getByRole('button', { name: copy.SubmitAnswer, exact: true }).click();
    await expect(
      page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true })
    ).toBeEnabled();
    const after = await Promise.all((await elements.all()).map((element) => element.boundingBox()));

    expect(after).toEqual(before);
    await expectScreenshot('stable-feedback', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true })
        ).toBeEnabled()
    });
  }
);
