import { Language, StudyError, plainBlock } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.browser.use({ aiEnabled: true, video: 'on' });

type BrowserContext = Pick<
  test.browser.Context,
  'page' | 'study' | 'ai' | 'rpc' | 'expect' | 'expectScreenshot' | 'setVisualViewportHeight'
>;

const cases = {
  english: {
    concept: 'Mitosis',
    question: 'Let’s talk about mitosis. How does it preserve the number of chromosomes?',
    unsupported: 'Planetary motion',
    hint: 'Think of what each chromosome looks like just before the cells split.',
    incomplete: 'The cell divides in two.',
    reply: 'Right, there are two cells. Let’s look at what goes into each one.',
    followup: 'What needs to happen to sister chromatids before the cells split?',
    final: 'They separate and each cell receives one copy of every chromosome.',
    feedback: 'You connected the separation of sister chromatids to what each cell inherits.',
    extraPage: 'Other notes',
    viewport: { width: 1440, height: 900 }
  },
  italian: {
    concept: 'Mitosi',
    question: 'Parliamo di mitosi. Come fa a conservare il numero di cromosomi?',
    unsupported: 'Moto dei pianeti',
    hint: 'Pensa a com’è fatto ogni cromosoma poco prima che le cellule si dividano.',
    incomplete: 'La cellula si divide in due.',
    reply: 'Esatto, si formano due cellule. Vediamo cosa va a finire in ognuna.',
    followup: 'Che cosa accade ai cromatidi fratelli prima che le cellule si separino?',
    final: 'Non ricordo che cosa si separa.',
    feedback: 'Ripassa come la separazione dei cromatidi conserva il numero di cromosomi.',
    extraPage: 'Altri appunti',
    viewport: { width: 420, height: 820 }
  }
} as const;

type Locale = keyof typeof cases;

async function startExam(
  { page, study, ai, rpc, expect, expectScreenshot }: BrowserContext,
  language: Locale
) {
  const copy = catalogs[language];
  const zoomPercent = language === 'italian' ? 100 : 125;
  const { concept, question, unsupported, extraPage, viewport } = cases[language];
  const fixture = await study.seed();
  const evidence = [{ name: fixture.page.title, preview: study.lecture }];
  const agent = study.agents.writtenExam;
  const start = { kind: 'start' as const, topic: concept };

  await rpc.runPromise(
    rpc.client['pages.create']({
      createKey: crypto.randomUUID(),
      projectId: fixture.project.id,
      title: extraPage,
      document: {
        blocks: [
          plainBlock(
            'paragraph',
            'Phases of the Moon change with its position relative to the Sun.',
            { type: 'authored' }
          )
        ],
        meta: fixture.page.version!.document.meta
      },
      inputs: [],
      citations: []
    })
  );
  await study.settings({ language: language === 'italian' ? Language.ITALIAN : Language.ENGLISH });
  await page.setViewportSize(viewport);
  await page.goto(`/practice?project=${fixture.project.id}`);
  const generate = page.getByRole('button', { name: copy.PracticeGenerate, exact: true });

  await generate.click();
  const setup = page.getByRole('dialog', { name: copy.PracticeGenerate });
  const choice = setup.getByRole('radio', { name: copy.WrittenExam, exact: true });

  await setup.getByRole('radio', { name: copy.SidebarQuiz, exact: true }).press('End');
  await expect(choice).toBeChecked();
  const topic = setup.getByRole('textbox', { name: copy.WrittenExamTopic });
  const begin = setup.getByRole('button', { name: copy.WrittenExamStart });
  const exclude = setup.getByRole('switch', { name: extraPage });

  const include = setup.getByRole('switch', { name: fixture.page.title });

  await expect(exclude).toBeChecked();
  await exclude.click();
  await include.click();
  await expectScreenshot('no-selected-pages', {
    target: setup,
    zoomPercent,
    ready: () => expect(begin).toBeDisabled()
  });
  await include.click();
  await topic.fill(unsupported);
  ai.next(agent, {
    input: { step: { kind: 'start', topic: unsupported }, evidence },
    output: { next: { kind: 'unavailable' } }
  });
  await begin.click();
  await expectScreenshot('unsupported-topic', {
    target: setup,
    zoomPercent,
    ready: () => expect(setup.getByText(copy.WrittenExamUnsupported)).toBeVisible()
  });
  await topic.fill(concept);
  await expectScreenshot('setup', {
    target: setup,
    zoomPercent,
    ready: () => expect(begin).toBeEnabled()
  });

  ai.failNext(agent, {
    input: { step: start, evidence },
    error: new StudyError('transient', 'First question unavailable')
  });
  await begin.click();
  await expectScreenshot('start-error', {
    target: setup,
    zoomPercent,
    ready: () => expect(setup.getByText(copy.WrittenExamStartError)).toBeVisible()
  });

  const opening = ai.next(agent, {
    input: { step: start, evidence },
    output: { next: { kind: 'opening', concept, question } },
    hold: true
  });

  await setup.getByRole('button', { name: copy.Retry }).click();
  await opening.called;
  await expectScreenshot('starting', {
    target: setup,
    zoomPercent,
    ready: () => expect(setup.getByText(copy.WrittenExamStarting).first()).toBeVisible()
  });
  opening.release();

  const exam = page.getByRole('dialog', { name: copy.WrittenExam });
  const answer = exam.getByRole('textbox', { name: copy.StudyChatMessage });
  const send = exam.getByRole('button', { name: copy.SendMessage });
  const log = exam.getByRole('log', { name: copy.WrittenExamConversation });

  if (language === 'english') await expect(answer).toBeFocused();
  else {
    await expect(exam).toBeVisible();
    expect(await exam.boundingBox()).toMatchObject({ x: 0, y: 0, ...viewport });
    await expect(send).toBeInViewport();
  }

  await expect(send).toBeDisabled();
  await expectScreenshot('question', {
    target: exam,
    zoomPercent,
    ready: () => expect(log.getByText(question)).toBeInViewport()
  });

  return { evidence, exam, answer, send, log, generate, setup };
}

async function checkLandscapeKeyboard(
  { page, expect, expectScreenshot, setVisualViewportHeight }: BrowserContext,
  { exam, answer, send, log }: Awaited<ReturnType<typeof startExam>>
) {
  await page.setViewportSize({ width: 844, height: 390 });
  await answer.focus();
  await setVisualViewportHeight(180);
  const sheetViewport = page.locator('[data-slot="dialog-viewport"]').filter({ has: exam });

  await expect(sheetViewport).toHaveCSS('height', '180px');
  await expect(log.getByText(cases.italian.question)).toBeInViewport({ ratio: 1 });
  await expect(send).toBeInViewport({ ratio: 1 });
  const sendBounds = (await send.boundingBox())!;

  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(180);
  await expectScreenshot('landscape-keyboard', {
    target: exam,
    zoomPercent: 100,
    ready: () => expect(answer).toBeFocused()
  });
  await setVisualViewportHeight(null);
  await page.setViewportSize(cases.italian.viewport);
}

async function continueExam(
  context: BrowserContext,
  language: Locale,
  session: Awaited<ReturnType<typeof startExam>>
) {
  const { page, study, ai, expect, expectScreenshot } = context;
  const { exam, answer, send, log, evidence } = session;
  const copy = catalogs[language];
  const zoomPercent = language === 'italian' ? 100 : 125;
  const { concept, question, incomplete, followup, reply, hint } = cases[language];
  const agent = study.agents.writtenExam;
  const hintButton = exam.getByRole('button', { name: copy.WrittenExamHint });
  const thinking = exam.getByRole('status', { name: copy.WrittenExamThinking });

  if (language === 'italian') await checkLandscapeKeyboard(context, session);

  await answer.fill(incomplete);
  const hintReply = ai.next(agent, {
    input: {
      step: { kind: 'hint', concept, history: [], current: { question }, draft: incomplete },
      evidence
    },
    output: { next: { kind: 'hint', message: hint } },
    hold: true
  });

  await hintButton.click();
  await hintReply.called;
  await expectScreenshot('hint-pending', {
    target: exam,
    zoomPercent,
    ready: () => expect(thinking).toBeVisible()
  });
  hintReply.release();
  await expectScreenshot('hint', {
    target: exam,
    zoomPercent,
    ready: () => expect(log.getByText(hint)).toBeInViewport()
  });
  await expect(log.getByText(copy.WrittenExamHintRequest)).toBeVisible();
  await expect(hintButton).toBeDisabled();
  await expect(answer).toHaveValue(incomplete);
  await answer.press('Escape');
  const confirm = page.getByRole('dialog', { name: copy.WrittenExamExitTitle });

  await expectScreenshot('confirm-exit', {
    target: confirm,
    zoomPercent,
    ready: () => expect(confirm).toBeVisible()
  });
  await confirm.getByRole('button', { name: copy.WrittenExamContinue }).click();
  await expect(answer).toHaveValue(incomplete);
  const history = [{ question, hint, answer: incomplete }] as const;
  const step = { kind: 'answer' as const, concept, history };

  ai.failNext(agent, {
    input: { step, evidence },
    error: new StudyError('transient', 'Reply unavailable')
  });
  await answer.press('Enter');
  await expectScreenshot('retry', {
    target: exam,
    zoomPercent,
    ready: () => expect(exam.getByText(copy.WrittenExamTurnError)).toBeInViewport()
  });
  await expect(answer).toHaveValue(incomplete);
  const next = ai.next(agent, {
    input: { step, evidence },
    output: { next: { kind: 'question', question: followup, reply } },
    hold: true
  });

  await send.click();
  await next.called;
  await expectScreenshot('reviewing-answer', {
    target: exam,
    zoomPercent,
    ready: () => expect(thinking).toBeVisible()
  });
  await expect(log.getByText(incomplete, { exact: true })).toBeVisible();
  next.release();
  await expectScreenshot('follow-up', {
    target: exam,
    zoomPercent,
    ready: () => expect(log.getByText(followup, { exact: false })).toBeInViewport()
  });
  await expect(log.getByText(reply, { exact: false })).toBeVisible();
  await expect(log.getByText(incomplete, { exact: true })).toBeVisible();
  await expect(answer).toHaveValue('');

  return { history };
}

async function finishExam(context: BrowserContext, language: Locale) {
  const { study, ai, expect, expectScreenshot } = context;
  const copy = catalogs[language];
  const zoomPercent = language === 'italian' ? 100 : 125;
  const { concept, incomplete, final, followup, reply, feedback } = cases[language];
  const session = await startExam(context, language);
  const { history } = await continueExam(context, language, session);
  const { exam, answer, send, evidence } = session;
  const early = language === 'italian';
  const summary = exam.getByRole('heading', {
    name: early ? copy.WrittenExamNeedsReview : copy.WrittenExamUnderstood
  });
  const ending = ai.next(study.agents.writtenExam, {
    input: {
      evidence,
      step: {
        kind: early ? 'finish' : 'answer',
        concept,
        history: [...history, { question: followup, reply, answer: final }]
      }
    },
    output: { next: { kind: 'summary', understood: !early, feedback } },
    hold: true
  });

  await answer.fill(final);
  await (early ? exam.getByRole('button', { name: copy.WrittenExamFinish }) : send).click();
  await ending.called;
  await expectScreenshot('preparing-summary', {
    target: exam,
    zoomPercent,
    ready: () => expect(exam.getByRole('status', { name: copy.WrittenExamThinking })).toBeVisible()
  });
  ending.release();
  await expectScreenshot('summary', {
    target: exam,
    zoomPercent,
    ready: () => expect(summary).toBeFocused()
  });
  await expect(exam.getByText(feedback)).toBeVisible();
  await exam.getByText(copy.WrittenExamHistory, { exact: true }).click();
  await expect(exam.getByText(incomplete, { exact: true })).toBeVisible();
  await expect(exam.getByText(final, { exact: true })).toBeVisible();

  return { ...session, summary, feedback };
}

test.browser.stable(
  'Written exam follows up and preserves the draft on retry in English',
  async ({ page, study, ai, rpc, expect, expectScreenshot, setVisualViewportHeight }) => {
    const { exam, summary, generate, setup, evidence } = await finishExam(
      { page, study, ai, rpc, expect, expectScreenshot, setVisualViewportHeight },
      'english'
    );
    const copy = catalogs.english;

    await expectScreenshot('transcript', {
      target: exam,
      ready: () => expect(exam.getByText(cases.english.final, { exact: true })).toBeVisible()
    });
    await summary.press('Escape');
    await expect(exam).toBeHidden();
    await expect(generate).toBeFocused();
    await generate.click();
    await setup.getByRole('radio', { name: copy.WrittenExam, exact: true }).click();
    await expect(setup.getByRole('textbox', { name: copy.WrittenExamTopic })).toBeEmpty();
    await setup.getByRole('switch', { name: cases.english.extraPage }).click();
    const opening = ai.next(study.agents.writtenExam, {
      input: { step: { kind: 'start' }, evidence },
      output: {
        next: { kind: 'opening', concept: cases.english.concept, question: cases.english.question }
      },
      hold: true
    });

    await setup.getByRole('button', { name: copy.WrittenExamStart }).click();
    await opening.called;
    await setup.getByRole('button', { name: copy.Close, exact: true, disabled: false }).click();
    await expect(setup).toBeHidden();
    await opening.aborted;
    await generate.click();
    await setup.getByRole('radio', { name: copy.WrittenExam, exact: true }).click();
    await setup.getByRole('switch', { name: cases.english.extraPage }).click();
    const reopenedQuestion = 'What happens to the copied chromosomes during cell division?';

    ai.next(study.agents.writtenExam, {
      input: { step: { kind: 'start' }, evidence },
      output: {
        next: {
          kind: 'opening',
          concept: cases.english.concept,
          question: reopenedQuestion
        }
      }
    });
    await setup.getByRole('button', { name: copy.WrittenExamStart }).click();
    const draft = exam.getByRole('textbox', { name: copy.StudyChatMessage });

    await expect(draft).toBeFocused();
    await expect(draft).toBeEmpty();
    await draft.fill('A new draft');
    const hint = ai.next(study.agents.writtenExam, {
      input: {
        evidence,
        step: {
          kind: 'hint',
          concept: cases.english.concept,
          current: { question: reopenedQuestion },
          draft: 'A new draft',
          history: []
        }
      },
      output: { next: { kind: 'hint', message: 'Think about the copies before division.' } },
      hold: true
    });

    await exam.getByRole('button', { name: copy.WrittenExamHint }).click();
    await hint.called;
    await exam.getByRole('button', { name: copy.WrittenExamExit }).click();
    const abandon = page.getByRole('dialog', { name: copy.WrittenExamExitTitle });

    await expectScreenshot('abandon-while-thinking', {
      target: 'viewport',
      ready: () => expect(abandon).toBeInViewport()
    });
    await abandon.getByRole('button', { name: copy.WrittenExamExit }).click();
    await expect(exam).toBeHidden();
    await expect(generate).toBeFocused();
    await hint.aborted;
  }
);

test.browser.describe('mobile browser', () => {
  test.browser.use({ isMobile: true, hasTouch: true });

  test.browser.stable(
    'Written exam keeps the question and answer reachable in Italian on mobile',
    async ({ page, study, ai, rpc, expect, expectScreenshot, setVisualViewportHeight }) => {
      const { exam, feedback, generate, setup } = await finishExam(
        { page, study, ai, rpc, expect, expectScreenshot, setVisualViewportHeight },
        'italian'
      );

      await expectScreenshot('transcript', {
        target: exam,
        zoomPercent: 100,
        ready: () => expect(exam.getByText(feedback, { exact: true })).toBeVisible()
      });
      await exam.getByRole('button', { name: catalogs.italian.Close, exact: true }).tap();
      await expect(exam).toBeHidden();
      expect((await rpc.runPromise(rpc.client['settings.appSettings']({}))).zoomPercent).toBe(125);
      await expect(page.locator('html')).toHaveCSS('zoom', '1');
      await generate.tap();
      await expectScreenshot('mobile-zoom-100', {
        target: setup,
        zoomPercent: 100,
        ready: () => expect(setup).toBeInViewport()
      });
      expect(await setup.boundingBox()).toMatchObject({ x: 0, y: 0, ...cases.italian.viewport });
    }
  );
});
