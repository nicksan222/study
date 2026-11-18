import { Language, StudyError, plainBlock } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.browser.use({ aiEnabled: true, video: 'on' });

type BrowserContext = Pick<
  test.browser.Context,
  'page' | 'study' | 'ai' | 'rpc' | 'expect' | 'expectScreenshot' | 'setVisualViewport'
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

async function examActions(
  page: BrowserContext['page'],
  exam: ReturnType<BrowserContext['page']['getByRole']>,
  copy: (typeof catalogs)[Locale]
) {
  await exam.getByRole('button', { name: copy.WrittenExamActions }).click();

  return page.getByRole('menu', { name: copy.WrittenExamActions });
}

async function checkSetupKeyboard(
  { page, expect, expectScreenshot, setVisualViewport }: BrowserContext,
  setup: Awaited<ReturnType<BrowserContext['page']['getByRole']>>
) {
  const copy = catalogs.italian;
  const topic = setup.getByRole('textbox', { name: copy.WrittenExamTopic });
  const retry = setup.getByRole('button', { name: copy.Retry });
  const begin = setup.getByRole('button', { name: copy.WrittenExamStart });

  await topic.focus();
  await setVisualViewport({ height: 180 });
  await expect(setup).toHaveCSS('height', '180px');
  await begin.scrollIntoViewIfNeeded();
  await expect(begin).toBeInViewport();
  await retry.scrollIntoViewIfNeeded();
  await expectScreenshot('setup-keyboard', {
    target: setup,
    zoomPercent: 100,
    ready: () => expect(retry).toBeInViewport()
  });
  await setVisualViewport({ height: 220, width: 210, offsetLeft: 70 });
  await expect(setup).toHaveCSS('width', '210px');
  expect(await setup.boundingBox()).toMatchObject({ x: 70, width: 210 });
  await begin.scrollIntoViewIfNeeded();
  await expectScreenshot('setup-pinched', {
    target: setup,
    zoomPercent: 100,
    ready: () => expect(begin).toBeInViewport({ ratio: 1 })
  });
  await page.setViewportSize({ width: 800, height: 800 });
  await setVisualViewport({ width: 400 });
  const format = setup.getByRole('radio', { name: copy.SidebarQuiz, exact: true });
  const sources = setup.getByRole('switch').first();

  await expect(setup).toHaveCSS('width', '368px');
  expect((await format.boundingBox())!.y).toBeLessThan((await sources.boundingBox())!.y);
  await expectScreenshot('setup-tablet-pinched', {
    target: setup,
    zoomPercent: 100,
    ready: () => expect(format).toBeInViewport()
  });
  await setVisualViewport(null);
  await page.setViewportSize(cases.italian.viewport);
}

async function startExam(
  { page, study, ai, rpc, expect, expectScreenshot, setVisualViewport }: BrowserContext,
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
  const quiz = setup.getByRole('radio', { name: copy.SidebarQuiz, exact: true });

  await quiz.click();
  await exclude.click();
  await choice.click();
  await expect(setup.getByText(copy.WrittenExamUnsupported)).toHaveCount(0);
  await exclude.click();
  await topic.fill(concept);
  await topic.scrollIntoViewIfNeeded();
  await expectScreenshot('setup', {
    target: setup,
    zoomPercent,
    center: language === 'english' ? topic : undefined,
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
    center: language === 'english' ? topic : undefined,
    ready: () => expect(setup.getByText(copy.WrittenExamStartError)).toBeVisible()
  });

  if (language === 'italian')
    await checkSetupKeyboard(
      { page, study, ai, rpc, expect, expectScreenshot, setVisualViewport },
      setup
    );

  const opening = ai.next(agent, {
    input: { step: start, evidence },
    output: { next: { kind: 'opening', concept, question } },
    hold: true
  });

  await setup.getByRole('button', { name: copy.Retry }).click();
  await opening.called;
  await expect(setup.getByText(copy.WrittenExamStartError)).toHaveCount(0);
  await expectScreenshot('starting', {
    target: setup,
    zoomPercent,
    center: language === 'english' ? topic : undefined,
    ready: () => expect(setup.getByText(copy.WrittenExamStarting).first()).toBeVisible()
  });
  opening.release();

  const exam = page.getByRole('region', { name: copy.WrittenExam });
  const answer = exam.getByRole('textbox', { name: copy.StudyChatMessage });
  const send = exam.getByRole('button', { name: copy.SendMessage });
  const log = exam.getByRole('log', { name: copy.WrittenExamConversation });

  await expect(page).toHaveURL(/\/practice\/written-exam$/);
  await expect(setup).toBeHidden();
  await expect(page.getByRole('dialog', { name: copy.WrittenExam, exact: true })).toHaveCount(0);
  await expect(
    exam.locator('[data-variant="notebook"]').getByRole('textbox', { name: copy.StudyChatMessage })
  ).toBeVisible();
  await expect(exam.getByRole('button', { name: copy.WrittenExamHint })).toHaveCount(0);
  await expect(exam.getByRole('button', { name: copy.WrittenExamFinish })).toHaveCount(0);

  if (language === 'english') await expect(answer).toBeFocused();
  else {
    await expect(exam).toBeVisible();
    expect(await exam.boundingBox()).toMatchObject({ x: 0, width: viewport.width });
    await expect(send).toBeInViewport();
  }

  await expect(send).toBeDisabled();
  await expectScreenshot('question', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(log.getByText(question)).toBeInViewport()
  });

  return { evidence, exam, answer, send, log, generate, setup, pageId: fixture.page.id };
}

async function checkLandscapeKeyboard(
  { page, expect, expectScreenshot, setVisualViewport }: BrowserContext,
  { exam, answer, send, log }: Awaited<ReturnType<typeof startExam>>
) {
  await page.setViewportSize({ width: 844, height: 390 });
  await answer.focus();
  await setVisualViewport({ height: 180 });

  await expect(exam).toHaveCSS('height', '180px');
  await expect(log.getByText(cases.italian.question)).toBeInViewport({ ratio: 1 });
  await expect(answer).toBeInViewport({ ratio: 1 });
  await expect(send).toBeInViewport({ ratio: 1 });
  const sendBounds = (await send.boundingBox())!;

  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(180);
  await expectScreenshot('landscape-keyboard', {
    target: exam,
    zoomPercent: 100,
    ready: () => expect(answer).toBeFocused()
  });
  await setVisualViewport({ height: 180, offsetTop: 30 }, 'scroll');
  await expect(exam).toHaveCSS('top', '30px');
  await setVisualViewport({ height: 120 });
  await expect(exam).toHaveCSS('height', '120px');
  await answer.scrollIntoViewIfNeeded();
  await expect(answer).toBeInViewport({ ratio: 1 });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport();
  const question = log.getByText(cases.italian.question);

  await question.scrollIntoViewIfNeeded();
  await expectScreenshot('landscape-compact', {
    target: exam,
    zoomPercent: 100,
    ready: () => expect(question).toBeInViewport()
  });
  await setVisualViewport({ height: 260, width: 270, offsetLeft: 42 });
  await expect(exam).toHaveCSS('width', '270px');
  await expect(exam).toHaveCSS('left', '42px');
  const pinnedSend = (await send.boundingBox())!;

  expect(pinnedSend.x + pinnedSend.width).toBeLessThanOrEqual(312);
  await expectScreenshot('exam-pinched', {
    target: exam,
    zoomPercent: 100,
    ready: () => expect(send).toBeInViewport({ ratio: 1 })
  });
  await setVisualViewport(null);
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
  const thinking = exam.getByRole('status', { name: copy.WrittenExamThinking });

  if (language === 'italian') await checkLandscapeKeyboard(context, session);

  await answer.fill(incomplete);
  await answer.press('End');
  await answer.press('Shift+Enter');
  await expect(answer).toHaveValue(`${incomplete}\n`);
  await answer.fill(incomplete);
  const hintReply = ai.next(agent, {
    input: {
      step: { kind: 'hint', concept, history: [], current: { question }, draft: incomplete },
      evidence
    },
    output: { next: { kind: 'hint', message: hint } },
    hold: true
  });

  const actions = await examActions(page, exam, copy);
  const hintItem = actions.getByRole('menuitem', { name: copy.WrittenExamHint });

  await expectScreenshot('exam-actions', {
    target: 'viewport',
    zoomPercent,
    ready: () => expect(hintItem).toBeInViewport({ ratio: 1 })
  });
  await hintItem.click();
  await hintReply.called;

  if (language === 'italian') await expect(answer).not.toBeFocused();

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
  await examActions(page, exam, copy);
  await expect(hintItem).toBeDisabled();
  await actions.press('Escape');
  await expect(actions).toBeHidden();
  await expect(answer).toHaveValue(incomplete);
  await exam.getByRole('button', { name: copy.WrittenExamBack }).click();
  const confirm = page.getByRole('dialog', { name: copy.WrittenExamExitTitle });

  await expectScreenshot('confirm-exit', {
    target: confirm,
    zoomPercent,
    ready: () => expect(confirm).toBeVisible()
  });
  await confirm.getByRole('button', { name: copy.WrittenExamContinue }).click();
  await expect(confirm).toBeHidden();
  await expect(answer).toHaveValue(incomplete);
  const history = [{ question, hint, answer: incomplete }] as const;
  const step = { kind: 'answer' as const, concept, history };

  ai.failNext(agent, {
    input: { step, evidence },
    error: new StudyError('transient', 'Reply unavailable')
  });
  await answer.click();
  await answer.press('Enter');
  await expectScreenshot('retry', {
    target: exam,
    zoomPercent,
    ready: async () => {
      await expect(answer).toBeFocused();
      await expect(exam.getByText(copy.WrittenExamTurnError)).toBeInViewport();
    }
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
    ready: () => expect(thinking).toBeInViewport({ ratio: 1 })
  });
  await expect(log.getByText(incomplete, { exact: true })).toBeVisible();

  if (language === 'english') {
    const viewport = exam.getByRole('region', { name: copy.WrittenExamConversation });

    await page.setViewportSize({ ...cases.english.viewport, height: 380 });
    await expect(viewport).not.toHaveJSProperty('scrollTop', 0);
    await viewport.press('Home');
    await expect(viewport).toHaveJSProperty('scrollTop', 0);
    await expect(exam.getByRole('button', { name: copy.JumpToLatest })).toBeVisible();
    await page.setViewportSize({ ...cases.english.viewport, height: 420 });
    await expect(viewport).toHaveJSProperty('scrollTop', 0);
    await expect(log.getByText(question, { exact: true })).toBeInViewport();
    await page.setViewportSize(cases.english.viewport);
    await answer.focus();
  }

  next.release();
  const nextQuestion = log.getByText(followup, { exact: false });

  await expectScreenshot('follow-up', {
    target: exam,
    zoomPercent,
    ready: async () => {
      await expect(nextQuestion).toBeInViewport({ ratio: 1 });
      await expect(exam.getByRole('button', { name: copy.JumpToLatest })).toHaveCount(0);
    }
  });
  await expect(nextQuestion).toBeInViewport({ ratio: 1 });
  await expect(log.getByText(reply, { exact: false })).toBeVisible();
  await expect(log.getByText(incomplete, { exact: true })).toBeVisible();
  await expect(answer).toHaveValue('');

  return { history };
}

async function assertTranscriptReachable(
  { expect }: BrowserContext,
  exam: Awaited<ReturnType<typeof startExam>>['exam'],
  answers: readonly string[]
) {
  for (const answer of answers) {
    const message = exam.getByText(answer, { exact: true });

    await message.scrollIntoViewIfNeeded();
    await expect(message).toBeInViewport();
  }
}

async function checkArchivedPageRecovery(
  { rpc, expect, expectScreenshot }: BrowserContext,
  { exam, answer, send, pageId }: Awaited<ReturnType<typeof startExam>>
) {
  const copy = catalogs.english;
  const draft = cases.english.final;
  const archive = (archived: boolean) =>
    rpc.runPromise(rpc.client['pages.archive']({ id: pageId, archived }));

  await archive(true);
  await answer.fill(draft);
  await send.click();
  await expectScreenshot('source-unavailable', {
    target: exam,
    ready: () => expect(exam.getByText(copy.WrittenExamSourceUnavailable)).toBeInViewport()
  });
  await expect(answer).toHaveValue(draft);
  await archive(false);
}

async function finishExam(context: BrowserContext, language: Locale) {
  const { page, study, ai, expect, expectScreenshot } = context;
  const copy = catalogs[language];
  const zoomPercent = language === 'italian' ? 100 : 125;
  const { concept, incomplete, final, followup, reply, feedback } = cases[language];
  const session = await startExam(context, language);
  const { history } = await continueExam(context, language, session);
  const { exam, answer, send, evidence } = session;
  const early = language === 'italian';

  if (!early) await checkArchivedPageRecovery(context, session);

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

  if (early) await answer.fill(final);
  else await expect(answer).toHaveValue(final);

  if (early) {
    const actions = await examActions(page, exam, copy);

    await actions.getByRole('menuitem', { name: copy.WrittenExamSubmitAndFinish }).click();
  } else await send.click();

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

async function checkUnansweredTranscript(
  { page, study, ai, expect, expectScreenshot }: BrowserContext,
  {
    exam,
    answer,
    send,
    evidence
  }: Pick<Awaited<ReturnType<typeof startExam>>, 'exam' | 'answer' | 'send' | 'evidence'>
) {
  const { concept, question, incomplete, followup, reply, hint, feedback } = cases.english;
  const copy = catalogs.english;
  const history = [{ question, answer: incomplete }] as const;
  const current = { question: followup, reply };
  const agent = study.agents.writtenExam;

  ai.next(agent, {
    input: { evidence, step: { kind: 'answer', concept, history } },
    output: { next: { kind: 'question', ...current } }
  });
  await answer.fill(incomplete);
  await send.click();
  await expect(answer).toBeEmpty();
  ai.next(agent, {
    input: { evidence, step: { kind: 'hint', concept, history, current } },
    output: { next: { kind: 'hint', message: hint } }
  });
  const actions = await examActions(page, exam, copy);

  await actions.getByRole('menuitem', { name: copy.WrittenExamHint }).click();
  await expect(exam.getByText(hint)).toBeVisible();
  ai.next(agent, {
    input: { evidence, step: { kind: 'finish', concept, history } },
    output: { next: { kind: 'summary', understood: false, feedback } }
  });
  await examActions(page, exam, copy);
  await actions.getByRole('menuitem', { name: copy.WrittenExamFinish }).click();
  await exam.getByText(copy.WrittenExamHistory, { exact: true }).click();
  await expect(exam.getByText(followup, { exact: false })).toHaveCount(1);
  const savedHint = exam.getByText(hint, { exact: true });

  await savedHint.scrollIntoViewIfNeeded();
  await expectScreenshot('unanswered-transcript', {
    target: exam,
    ready: () => expect(savedHint).toBeInViewport()
  });
}

async function checkSettingsExit(
  { page, rpc, expect, expectScreenshot }: BrowserContext,
  { exam, answer }: Pick<Awaited<ReturnType<typeof startExam>>, 'exam' | 'answer'>
) {
  const copy = catalogs.english;
  const draft = cases.english.incomplete;
  const confirm = page.getByRole('dialog', { name: copy.WrittenExamExitTitle });
  const settings = exam.getByRole('button', { name: copy.Settings, exact: true });

  await answer.fill(draft);
  await rpc.runPromise(rpc.client['auth.signOut']({}));
  await settings.click();
  await expectScreenshot('settings-exit', {
    target: confirm,
    ready: () => expect(confirm).toBeVisible()
  });
  await confirm.getByRole('button', { name: copy.WrittenExamContinue }).click();
  await expect(answer).toHaveValue(draft);
  await settings.click();
  await confirm.getByRole('button', { name: copy.WrittenExamExit }).click();
  const settingsDialog = page.getByRole('dialog', { name: copy.Settings });

  await expect(settingsDialog).toBeVisible();
  await settingsDialog.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(exam).toBeHidden();
}

async function reopenEnglishExam(
  { study, ai, expect }: BrowserContext,
  { generate, setup, evidence }: Awaited<ReturnType<typeof finishExam>>,
  question: string = cases.english.question,
  hold = false
) {
  const copy = catalogs.english;

  await generate.click();
  await setup.getByRole('radio', { name: copy.WrittenExam, exact: true }).click();
  await expect(setup.getByRole('textbox', { name: copy.WrittenExamTopic })).toBeEmpty();
  await setup.getByRole('switch', { name: cases.english.extraPage }).click();
  const opening = ai.next(study.agents.writtenExam, {
    input: { step: { kind: 'start' }, evidence },
    output: { next: { kind: 'opening', concept: cases.english.concept, question } },
    hold
  });

  await setup.getByRole('button', { name: copy.WrittenExamStart }).click();

  return opening;
}

test.browser.stable(
  'Written exam follows up and preserves the draft on retry in English',
  async ({ page, study, ai, rpc, expect, expectScreenshot, setVisualViewport }) => {
    const context = { page, study, ai, rpc, expect, expectScreenshot, setVisualViewport };
    const session = await finishExam(context, 'english');
    const { exam, generate, setup, evidence, answer, send } = session;
    const copy = catalogs.english;

    await expectScreenshot('transcript', {
      target: exam,
      ready: () => expect(exam.getByText(cases.english.final, { exact: true })).toBeVisible()
    });
    await assertTranscriptReachable(context, exam, [cases.english.incomplete, cases.english.final]);
    await exam.getByRole('button', { name: copy.WrittenExamBack }).click();
    await expect(exam).toBeHidden();
    await expect(page).toHaveURL(/\/practice\/?$/);
    await expect(generate).toBeFocused();
    const opening = await reopenEnglishExam(context, session, cases.english.question, true);

    await opening.called;
    await setup.getByRole('button', { name: copy.Close, exact: true, disabled: false }).click();
    await expect(setup).toBeHidden();
    await opening.aborted;
    const reopenedQuestion = 'What happens to the copied chromosomes during cell division?';

    await reopenEnglishExam(context, session, reopenedQuestion);
    await expect(answer).toBeFocused();
    await expect(answer).toBeEmpty();
    await answer.fill('A new draft');
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

    const actions = await examActions(page, exam, copy);

    await actions.getByRole('menuitem', { name: copy.WrittenExamHint }).click();
    await hint.called;
    await exam.getByRole('button', { name: copy.WrittenExamBack }).click();
    const abandon = page.getByRole('dialog', { name: copy.WrittenExamExitTitle });

    await expectScreenshot('abandon-while-thinking', {
      target: 'viewport',
      ready: () => expect(abandon).toBeInViewport()
    });
    await abandon.getByRole('button', { name: copy.WrittenExamExit }).click();
    await expect(exam).toBeHidden();
    await expect(page).toHaveURL(/\/practice\/?$/);
    await expect(generate).toBeFocused();
    await hint.aborted;
    await reopenEnglishExam(context, session);
    await checkUnansweredTranscript(context, { exam, answer, send, evidence });
    await exam.getByRole('button', { name: copy.WrittenExamBack }).click();
    await reopenEnglishExam(context, session);
    await checkSettingsExit(context, { exam, answer });
  }
);

test.browser.stable(
  'Written exam preserves a pending reply and draft across resize',
  async ({ page, study, rpc, ai, expect, expectScreenshot }) => {
    const seed = await study.seed();
    const copy = catalogs.english;
    const concept = 'ChromosomeSegregation'.repeat(6);
    const question = cases.english.question;
    const draft = cases.english.incomplete;
    const evidence = [{ name: seed.page.title, preview: study.lecture }];
    const material = await rpc.runPromise(
      rpc.client['materials.create']({
        projectId: seed.project.id,
        title: 'Cell division quiz',
        content: {
          kind: 'quiz',
          questions: [
            { kind: 'open', prompt: question, referenceAnswer: draft, explanation: draft }
          ]
        }
      })
    );

    await page.setViewportSize({ width: 900, height: 850 });
    const practiceUrl = `/projects/${seed.project.id}/practice`;

    await page.goto(practiceUrl);
    const sidebar = page.getByRole('complementary', { name: copy.SidebarNavigation });
    const quiz = sidebar.getByRole('link', { name: /Cell division quiz/ });
    const generate = sidebar.getByRole('button', { name: copy.PracticeGenerate, exact: true });
    const setup = page.getByRole('dialog', { name: copy.PracticeGenerate });
    const opening = ai.next(study.agents.writtenExam, {
      input: { step: { kind: 'start' }, evidence },
      output: { next: { kind: 'opening', concept, question } },
      hold: true
    });

    await quiz.click();
    await generate.click();
    await setup.getByRole('radio', { name: copy.WrittenExam, exact: true }).click();
    await setup.getByRole('button', { name: copy.WrittenExamStart }).click();
    await opening.called;
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${practiceUrl}$`));
    await expect(setup).toBeHidden();
    await opening.aborted;

    await quiz.click();
    await generate.click();
    await setup.getByRole('radio', { name: copy.WrittenExam, exact: true }).click();
    ai.next(study.agents.writtenExam, {
      input: { step: { kind: 'start' }, evidence },
      output: { next: { kind: 'opening', concept, question } }
    });
    await setup.getByRole('button', { name: copy.WrittenExamStart }).click();
    const exam = page.getByRole('region', { name: copy.WrittenExam });
    const answer = exam.getByRole('textbox', { name: copy.StudyChatMessage });

    await answer.fill(draft);
    const hint = ai.next(study.agents.writtenExam, {
      input: {
        step: { kind: 'hint', concept, history: [], current: { question }, draft },
        evidence
      },
      output: { next: { kind: 'hint', message: cases.english.hint } },
      hold: true
    });

    const actions = await examActions(page, exam, copy);

    await actions.getByRole('menuitem', { name: copy.WrittenExamHint }).click();
    await hint.called;
    await page.setViewportSize({ width: 620, height: 850 });
    await expect(page.locator('#study-sidebar-navigation')).toBeHidden();
    await expect(exam.getByText(concept)).toHaveCSS('overflow-wrap', 'anywhere');
    await expectScreenshot('resize-pending', {
      target: exam,
      ready: () =>
        expect(exam.getByRole('status', { name: copy.WrittenExamThinking })).toBeVisible()
    });
    await expect(answer).toHaveValue(draft);
    await page.setViewportSize({ width: 900, height: 850 });
    hint.release();
    await expectScreenshot('resize-reply', {
      target: exam,
      ready: () => expect(exam.getByText(cases.english.hint, { exact: true })).toBeInViewport()
    });
    await expect(answer).toHaveValue(draft);
    await page.setViewportSize({ width: 620, height: 850 });
    await exam.getByRole('button', { name: copy.WrittenExamBack, exact: true }).click();
    await page
      .getByRole('dialog', { name: copy.WrittenExamExitTitle })
      .getByRole('button', { name: copy.WrittenExamExit, exact: true })
      .click();
    await expect(exam).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/practice/${material.id}$`));
    await expect(
      page.getByRole('main').getByRole('button', { name: copy.ToggleSidebar })
    ).toBeFocused();
  }
);

test.browser.describe('mobile browser', () => {
  test.browser.use({ isMobile: true, hasTouch: true });

  test.browser.stable(
    'Written exam keeps the question and answer reachable in Italian on mobile',
    async ({ page, study, ai, rpc, expect, expectScreenshot, setVisualViewport }) => {
      const { exam, feedback, generate, setup } = await finishExam(
        { page, study, ai, rpc, expect, expectScreenshot, setVisualViewport },
        'italian'
      );

      await expectScreenshot('transcript', {
        target: exam,
        zoomPercent: 100,
        ready: () => expect(exam.getByText(feedback, { exact: true })).toBeVisible()
      });
      await assertTranscriptReachable(
        { page, study, ai, rpc, expect, expectScreenshot, setVisualViewport },
        exam,
        [cases.italian.incomplete, cases.italian.final]
      );
      await exam.getByRole('button', { name: catalogs.italian.WrittenExamBack }).tap();
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
