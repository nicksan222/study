import { defaultQuizSettings, Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

type Context = Pick<test.browser.Context, 'page' | 'rpc' | 'expect'>;

type Copy = (typeof catalogs)['english' | 'italian'];

async function frame({ page }: Context) {
  const content = page.locator('.study-practice-content');

  return Promise.all([
    content.boundingBox(),
    content.locator('.study-practice-stage-body').boundingBox(),
    content.locator('.study-practice-stage-footer').boundingBox(),
    content.locator('.study-practice-stage-footer > :is(button, a)').boundingBox()
  ]);
}

async function submit({ page }: Context, copy: Copy) {
  await page.getByRole('radio', { name: copy.PracticeTrue, exact: false }).check();
  await page.getByRole('button', { name: copy.SubmitAnswer, exact: true }).click();
  await page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true }).click();
}

async function checkCompletion(context: Context, copy: Copy, timing: 'end' | 'immediate') {
  const { page, rpc, expect } = context;

  await rpc.runPromise(
    rpc.client['settings.saveQuizSettings']({
      ...defaultQuizSettings,
      feedbackTiming: timing,
      shuffleChoices: false
    })
  );
  const material = await rpc.runPromise(
    rpc.client['materials.create']({
      title: 'Cell biology practice',
      content: {
        kind: 'quiz',
        questions: [
          {
            kind: 'true_false',
            prompt: 'The cell membrane regulates what enters and leaves the cell.',
            isTrue: true,
            explanation: 'A selectively permeable membrane regulates transport.'
          },
          {
            kind: 'true_false',
            prompt: 'The nucleus stores genetic information.',
            isTrue: true,
            explanation: 'The nucleus contains most of the cell’s DNA.'
          }
        ]
      }
    })
  );

  await page.goto(`/practice/${material.id}`);
  await page.getByRole('button', { name: copy.PracticeStartQuiz, exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'The cell membrane regulates what enters and leaves the cell.'
    })
  ).toBeVisible();
  const questionFrame = await frame(context);

  await submit(context, copy);
  await expect(
    page.getByRole('heading', { name: 'The nucleus stores genetic information.' })
  ).toBeVisible();
  expect(await frame(context)).toEqual(questionFrame);
  await submit(context, copy);
  await expect(page.getByRole('heading', { name: copy.QuizReviewAnswers })).toBeVisible();
  expect(await frame(context)).toEqual(questionFrame);
  await page
    .getByRole('button', { name: new RegExp(`^${copy.QuizEditAnswer}:`) })
    .first()
    .click();
  await expect(
    page.getByRole('button', { name: copy.QuizBackToReview, exact: true })
  ).toBeVisible();
  expect(await frame(context)).toEqual(questionFrame);
  await page.getByRole('button', { name: copy.QuizBackToReview, exact: true }).click();
  await page.getByRole('button', { name: copy.PracticeFinishQuiz, exact: true }).click();
  await expect(page.locator('.study-practice-results')).toBeVisible();
  expect(await frame(context)).toEqual(questionFrame);
  await expect(page.locator('.study-practice-result-content')).toHaveCSS('max-width', 'none');
  await page
    .locator('.study-practice-results .study-practice-footer-context')
    .getByRole('button')
    .last()
    .click();
  expect(await frame(context)).toEqual(questionFrame);
  await page.getByRole('link', { name: copy.PracticeTryAgain, exact: true }).click();
  await expect(
    page.getByRole('button', { name: copy.PracticeStartQuiz, exact: true })
  ).toBeVisible();
  const setup = await frame(context);

  expect([setup[0], setup[2], setup[3]]).toEqual([
    questionFrame[0],
    questionFrame[2],
    questionFrame[3]
  ]);
}

async function checkSizes(context: Context, language: 'english' | 'italian', width: number) {
  const { page, rpc } = context;
  const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

  await rpc.runPromise(
    rpc.client['settings.saveAppSettings']({
      ...settings,
      language: language === 'italian' ? Language.ITALIAN : Language.ENGLISH
    })
  );
  await page.setViewportSize({ width, height: 900 });

  for (const timing of ['end', 'immediate'] as const)
    await checkCompletion(context, catalogs[language], timing);
}

test.browser.stable(
  'Practice completion keeps its frame english 800',
  async ({ page, rpc, expect, expectScreenshot }) => {
    await checkSizes({ page, rpc, expect }, 'english', 800);
    await expectScreenshot('returned-to-quiz', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', { name: catalogs.english.PracticeStartQuiz, exact: true })
        ).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice completion keeps its frame english 1440',
  async ({ page, rpc, expect, expectScreenshot }) => {
    await checkSizes({ page, rpc, expect }, 'english', 1440);
    await expectScreenshot('returned-to-quiz', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', { name: catalogs.english.PracticeStartQuiz, exact: true })
        ).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice completion keeps its frame italian 800',
  async ({ page, rpc, expect, expectScreenshot }) => {
    await checkSizes({ page, rpc, expect }, 'italian', 800);
    await expectScreenshot('returned-to-quiz', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', { name: catalogs.italian.PracticeStartQuiz, exact: true })
        ).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice completion keeps its frame italian 1440',
  async ({ page, rpc, expect, expectScreenshot }) => {
    await checkSizes({ page, rpc, expect }, 'italian', 1440);
    await expectScreenshot('returned-to-quiz', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', { name: catalogs.italian.PracticeStartQuiz, exact: true })
        ).toBeVisible()
    });
  }
);
