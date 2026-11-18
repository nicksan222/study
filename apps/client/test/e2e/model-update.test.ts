import { Language, LlmProvider } from '@study/contracts';
import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';
import { Schema } from 'effect';
import type { Page } from 'playwright';

const earlier = { model: 'gpt-6.1-sol', title: 'Cell Study' };

const newer = { model: 'gpt-6.2-sol', title: 'Cell Division' };

const latest = { model: 'gpt-6.3-sol', title: 'Chromosome Division' };

const english = catalogs.english;

const italian = catalogs.italian;

const frame = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.String,
      id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      tag: Schema.optional(Schema.String),
      requestId: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      values: Schema.optional(
        Schema.Array(
          Schema.Struct({
            _tag: Schema.String,
            result: Schema.optional(Schema.Struct({ _tag: Schema.String }))
          })
        )
      )
    })
  )
);

function afterFrame() {
  return new Promise<boolean>((resolve) => {
    requestAnimationFrame(() => resolve(true));
  });
}

function waitForNoticeSnapshot(page: Page) {
  const ready = Promise.withResolvers<void>();

  page.once('websocket', (socket) => {
    let requestId: string | number | undefined;

    socket.on('framesent', ({ payload }) => {
      const request = frame(String(payload).trim());

      if (request._tag === 'Some' && request.value.tag === 'settings.modelUpdates.live')
        requestId = request.value.id;
    });
    socket.on('framereceived', ({ payload }) => {
      for (const line of String(payload).trim().split('\n')) {
        const message = frame(line);

        if (
          requestId !== undefined &&
          message._tag === 'Some' &&
          message.value._tag === 'Chunk' &&
          message.value.requestId === requestId &&
          message.value.values?.some(
            (value) => value._tag === 'Snapshot' && value.result?._tag === 'Success'
          )
        )
          ready.resolve();
      }
    });
  });

  return ready.promise;
}

test.browser.use({
  chatGpt: {
    chatGptReleases: [
      { model: earlier.model, text: earlier.title },
      { model: newer.model, text: newer.title },
      { model: latest.model, text: latest.title }
    ]
  }
});

test.browser.stable(
  'New model version appears once and stays dismissed',
  async ({ page, rpc, expect, expectScreenshot, selectChatGptRelease }) => {
    const note = await rpc.runPromise(
      rpc.client['notes.createUntitledNote']({
        initialMessage: { text: 'Mitosis produces two daughter cells.' }
      })
    );
    const configured = await rpc.runPromise(rpc.client['settings.llmSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveLlmSettings']({
        ...configured,
        tiny: { provider: LlmProvider.CHAT_GPT, model: earlier.model },
        medium: { provider: 'deepseek' },
        smart: { provider: 'deepseek' }
      })
    );
    const generateTitle = async () => {
      const request = await rpc.runPromise(rpc.client['notes.requestTitle']({ noteId: note.id }));

      await expect
        .poll(async () => {
          const { items } = await rpc.runPromise(
            rpc.client['workflows.executions']({ correlationId: request.requestId, limit: 1 })
          );

          return items[0]?.outcome;
        })
        .toBe('success');
    };

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.goto(`/notes/${note.id}`);
    const viewport = page.locator('.ui-toast-viewport');
    const title = (text: string) => page.getByText(text, { exact: true }).first();
    const announcement = viewport.getByText(english.ModelUpdateAvailable, { exact: true });

    await selectChatGptRelease(earlier.model);
    await generateTitle();
    expect(await rpc.runPromise(rpc.client['settings.modelUpdates']({}))).toEqual([]);
    await expect(announcement).toHaveCount(0);
    await expectScreenshot('before-update', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(title(earlier.title)).toBeVisible()
    });

    await selectChatGptRelease(newer.model);
    await generateTitle();
    await expect(title(earlier.title)).toBeVisible();
    expect((await rpc.runPromise(rpc.client['settings.llmSettings']({}))).tiny.model).toBe(
      earlier.model
    );
    const versions = { previous: earlier.model, model: newer.model };
    const description = createLocalization('english').t('ModelUpdateOffer', {
      ...versions,
      tier: english.AiSettingsTiny
    });

    await expectScreenshot('updated-on-desktop', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(viewport.getByText(description, { exact: true })).toBeVisible()
    });

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({
        ...settings,
        language: Language.ITALIAN,
        zoomPercent: 100
      })
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDescription = createLocalization('italian').t('ModelUpdateOffer', {
      ...versions,
      tier: italian.AiSettingsTiny
    });

    await expectScreenshot('updated-on-mobile', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () =>
        expect(viewport.getByText(mobileDescription, { exact: true })).toBeInViewport({ ratio: 1 })
    });
    await page.keyboard.press('F6');
    await expect(viewport).toBeFocused();
    await viewport.getByRole('button', { name: italian.Close, exact: true }).press('Enter');
    await expect.poll(() => rpc.runPromise(rpc.client['settings.modelUpdates']({}))).toEqual([]);
    await generateTitle();
    expect(await rpc.runPromise(rpc.client['settings.modelUpdates']({}))).toEqual([]);
    await page.setViewportSize({ width: 1120, height: 760 });
    const loadedNotice = waitForNoticeSnapshot(page);

    await page.reload();
    await loadedNotice;
    await page.waitForFunction(afterFrame);
    await page.waitForFunction(afterFrame);
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expectScreenshot('dismissed-after-reload', {
      target: 'viewport',
      zoomPercent: 100,
      ready: async () => {
        await expect(title(earlier.title)).toBeVisible();
        await expect(viewport.getByText(italian.ModelUpdateAvailable, { exact: true })).toHaveCount(
          0
        );
      }
    });
    await selectChatGptRelease(latest.model);
    await viewport.getByRole('button', { name: italian.ModelUpdateAction }).click();
    await expect
      .poll(async () => (await rpc.runPromise(rpc.client['settings.llmSettings']({}))).tiny.model)
      .toBe(latest.model);
    await generateTitle();
    await expect(title(latest.title)).toBeVisible();
  }
);
