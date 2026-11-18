import {
  defaultQuizSettings,
  Language,
  gradeInputSchema,
  gradeOutputSchema
} from '@study/contracts';
import type { materialQuestionInputSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

// Real persisted attempts exercise every editor, including delayed model grading.
test.browser.use({ aiEnabled: true });

type BrowserContext = Pick<test.browser.Context, 'page' | 'rpc' | 'study' | 'ai' | 'expect'>;

type Copy = (typeof catalogs)['english' | 'italian'];

type Question = typeof materialQuestionInputSchema.Type;

type Outcome = 'correct' | 'incorrect' | 'partly';

const longText =
  'A longer answer that wraps across several lines in a narrow window, explaining how a selectively permeable cell membrane controls the passage of substances.';

const explanation = 'The membrane maintains the conditions required inside a living cell. '
  .repeat(12)
  .trim();

const choices = [
  { text: longText, isCorrect: true },
  { text: 'Energy', isCorrect: false },
  { text: 'Transport', isCorrect: true }
];

const items = [{ text: longText }, { text: 'Replication' }, { text: 'Division' }];

const pairs = [
  { term: 'Membrane', definition: longText },
  { term: 'Nucleus', definition: 'Genetic information' },
  { term: 'Mitochondrion', definition: 'Energy production' }
];

const cases: { question: Question; outcome: Outcome }[] = [];

for (const outcome of ['correct', 'incorrect', 'partly'] as const) {
  for (const kind of [
    'single_choice',
    'multiple_choice',
    'true_false',
    'ordering',
    'matching',
    'open',
    'fill_blank'
  ] as const) {
    if (outcome === 'partly' && (kind === 'single_choice' || kind === 'true_false')) continue;

    const prompt = `${kind}: ${longText}${kind === 'fill_blank' ? ' ____' : ''}`;
    const common = { prompt, explanation };
    const question: Question =
      kind === 'true_false'
        ? { ...common, kind, isTrue: true }
        : kind === 'ordering'
          ? { ...common, kind, items }
          : kind === 'matching'
            ? { ...common, kind, pairs }
            : kind === 'open' || kind === 'fill_blank'
              ? { ...common, kind, referenceAnswer: longText }
              : {
                  ...common,
                  kind,
                  choices: kind === 'single_choice' ? choices.slice(0, 2) : choices
                };

    cases.push({ question, outcome });
  }
}

async function fillResponse(
  { page, ai, expect }: Pick<test.browser.Context, 'page' | 'ai' | 'expect'>,
  question: Question,
  outcome: Outcome,
  copy: (typeof catalogs)['english' | 'italian']
) {
  if (question.kind === 'open' || question.kind === 'fill_blank')
    return fillText({ page, ai }, question, outcome);

  if (question.kind === 'matching') {
    await fillMatching(page, outcome, expect);
  } else if (question.kind === 'ordering') {
    await fillOrdering(page, outcome, copy);
  } else await fillChoice(page, question, outcome, copy);

  return undefined;
}

async function fillText(
  { page, ai }: Pick<BrowserContext, 'page' | 'ai'>,
  question: Question,
  outcome: Outcome
) {
  const form = page.locator('.study-practice-question');
  const answer =
    outcome === 'correct'
      ? longText
      : outcome === 'partly'
        ? 'A protective barrier'
        : 'It produces sunlight';

  const grading = ai.next(
    {
      id: 'learning-grade',
      input: gradeInputSchema,
      output: gradeOutputSchema,
      mode: 'object'
    },
    {
      input: {
        prompt: JSON.stringify({ question: question.prompt, reference: longText, answer })
      },
      output: {
        verdict: outcome,
        feedback: 'Compare the function of the membrane with the reference.'
      },
      hold: true
    }
  );

  await form.getByRole('textbox').fill(answer);

  return grading;
}

async function fillChoice(
  page: BrowserContext['page'],
  question: Question,
  outcome: Outcome,
  copy: Copy
) {
  const form = page.locator('.study-practice-question');

  if (question.kind === 'true_false') {
    await form
      .getByRole('radio', {
        name: outcome === 'correct' ? copy.PracticeTrue : copy.PracticeFalse,
        exact: false
      })
      .check();
  } else {
    const input = form.getByRole(question.kind === 'multiple_choice' ? 'checkbox' : 'radio');

    await input.nth(outcome === 'incorrect' ? 1 : 0).check();

    if (question.kind === 'multiple_choice' && outcome === 'correct') await input.nth(2).check();
  }
}

async function fillMatching(
  page: BrowserContext['page'],
  outcome: Outcome,
  expect: BrowserContext['expect']
) {
  const form = page.locator('.study-practice-question');
  const permutation =
    outcome === 'correct' ? [0, 1, 2] : outcome === 'partly' ? [0, 2, 1] : [1, 2, 0];

  for (const [index, pair] of pairs.entries()) {
    await form.getByRole('combobox', { name: pair.term, exact: true }).click();
    const definition = pairs[permutation[index]!]!.definition;
    const popup = page.locator('.study-select-popup[data-open]');
    const option = popup.getByRole('option', { name: definition, exact: true });

    await expect(option).toBeVisible();
    await expect(popup).toHaveCSS('opacity', '1');
    await option.click();
    await expect(page.getByRole('combobox', { name: pair.term, exact: true })).toHaveText(
      definition
    );
    await expect(page.getByRole('listbox', { name: pair.term, exact: true })).toHaveCount(0);
  }
}

async function fillOrdering(page: BrowserContext['page'], outcome: Outcome, copy: Copy) {
  const form = page.locator('.study-practice-question');
  const sequence = outcome === 'correct' ? [0, 1, 2] : outcome === 'partly' ? [0, 2, 1] : [1, 2, 0];

  for (const [position, index] of sequence.entries()) {
    const row = form
      .locator('.study-practice-ordering > li')
      .filter({ hasText: items[index]!.text });
    const current = (
      await form.locator('.study-practice-ordering > li').allTextContents()
    ).findIndex((text) => text.includes(items[index]!.text));

    for (let move = current; move > position; move--)
      await row.getByRole('button', { name: copy.PracticeMoveUp, exact: true }).click();
  }
}

async function verifyGeometry(
  {
    page,
    rpc,
    study,
    ai,
    expect
  }: Pick<test.browser.Context, 'page' | 'rpc' | 'study' | 'ai' | 'expect'>,
  language: 'english' | 'italian',
  width: number,
  motion: 'reduce' | 'no-preference'
) {
  await study.seed();
  const copy = catalogs[language];
  const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

  await rpc.runPromise(
    rpc.client['settings.saveAppSettings']({
      ...settings,
      language: language === 'italian' ? Language.ITALIAN : Language.ENGLISH
    })
  );
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: motion });

  for (const { timing, question, outcome } of (['end', 'immediate'] as const).flatMap((timing) =>
    cases.map((item) => ({ timing, ...item }))
  )) {
    await rpc.runPromise(
      rpc.client['settings.saveQuizSettings']({
        ...defaultQuizSettings,
        feedbackTiming: timing,
        shuffleChoices: false
      })
    );

    const context = `${language}/${width}/${motion}/${timing}/${question.kind}/${outcome}`;

    await verifyCase({ page, rpc, study, ai, expect }, question, outcome, timing, copy, context);
  }
}

async function verifyCase(
  { page, rpc, study, ai, expect }: BrowserContext,
  question: Question,
  outcome: Outcome,
  timing: 'end' | 'immediate',
  copy: Copy,
  context: string
) {
  const material = await rpc.runPromise(
    rpc.client['materials.create']({
      title: context,
      content: { kind: 'quiz', questions: [question] }
    })
  );

  await page.goto(`/practice/${material.id}`);
  await page.getByRole('button', { name: copy.PracticeStartQuiz, exact: true }).click();
  const form = page.locator('.study-practice-question');

  await expect(form.getByRole('heading', { name: question.prompt })).toBeVisible();
  const grading = await fillResponse({ page, ai, expect }, question, outcome, copy);
  // Include text spans and every existing control, not just the outer answer box.
  const selector =
    '.study-practice-prompt, .study-practice-stage-body > .study-practice-muted, .study-practice-answers, .study-practice-answers label, .study-practice-answers label > span:not(.sr-only), .study-practice-answers .study-practice-ordering > li, .study-practice-answers .study-practice-ordering > li > span, .study-practice-answers button, .study-practice-matching-row, .study-practice-answers input:not([type=radio]):not([type=checkbox]), .study-practice-answers textarea, .study-practice-stage-footer, .study-practice-stage-footer button, .study-practice-footer-context';
  const elements = form.locator(selector);
  const measureBoxes = async () =>
    Promise.all((await elements.all()).map((element) => element.boundingBox()));

  await page.getByRole('button', { name: copy.SubmitAnswer, exact: true }).scrollIntoViewIfNeeded();
  const before = await measureBoxes();

  await page.getByRole('button', { name: copy.SubmitAnswer, exact: true }).click();
  await expect(
    page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true })
  ).toBeEnabled();
  const measure = async () => expect(await measureBoxes(), context).toEqual(before);

  await measure();

  await settleGrading({ page, rpc, study, ai, expect }, grading, timing, outcome, copy, measure);

  if (timing === 'immediate') {
    await expect(form.locator('.study-practice-feedback')).toBeVisible();
    await expect(form.locator('.study-practice-feedback')).toHaveCSS('opacity', '1');
    await measure();
  } else await expect(form.locator('[data-tone]')).toHaveCount(0);

  await expect(
    page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true })
  ).toBeFocused();
  await page.getByRole('button', { name: copy.PracticeNextQuestion, exact: true }).press('Enter');
  await page.getByRole('button', { name: copy.PracticeFinishQuiz, exact: true }).click();
  await expect(page.getByText(expectedPercentage(question, outcome))).toBeVisible();
}

async function settleGrading(
  { page, expect }: BrowserContext,
  grading: Awaited<ReturnType<typeof fillResponse>>,
  timing: 'end' | 'immediate',
  outcome: Outcome,
  copy: Copy,
  measure: () => Promise<void>
) {
  const form = page.locator('.study-practice-question');

  if (grading) {
    await grading.called;
    await measure();
    grading.release();

    if (timing === 'immediate') {
      const verdict =
        copy[
          outcome === 'correct'
            ? 'VerdictCorrect'
            : outcome === 'partly'
              ? 'VerdictPartly'
              : 'VerdictIncorrect'
        ];

      await expect(form.getByRole('status').filter({ hasText: verdict })).toHaveText(verdict);
    }
  }
}

function expectedPercentage(question: Question, outcome: Outcome) {
  if (outcome === 'correct') return /^100%/;

  if (outcome !== 'partly') return /^0%/;

  if (question.kind === 'matching') return /^33%/;

  return question.kind === 'open' || question.kind === 'fill_blank' ? /^50%/ : /^0%/;
}

test.browser.stable(
  'Practice geometry english 800 reduced',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'english', 800, 'reduce');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry english 800 animated',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'english', 800, 'no-preference');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry english 1440 reduced',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'english', 1440, 'reduce');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry english 1440 animated',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'english', 1440, 'no-preference');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry italian 800 reduced',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'italian', 800, 'reduce');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry italian 800 animated',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'italian', 800, 'no-preference');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry italian 1440 reduced',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'italian', 1440, 'reduce');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);

test.browser.stable(
  'Practice geometry italian 1440 animated',
  async ({ page, rpc, study, ai, expect, expectScreenshot }) => {
    await verifyGeometry({ page, rpc, study, ai, expect }, 'italian', 1440, 'no-preference');
    await expectScreenshot('completed', {
      target: 'viewport',
      ready: () => expect(page.locator('.study-practice-results')).toBeVisible()
    });
  }
);
