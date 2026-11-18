import { Language, LlmProvider } from '@study/contracts';
import { catalogs, createLocalization } from '@study/localization';
import { test } from '@study/testing';

const earlier = { model: 'gpt-6.1-sol', title: 'Cell Study' };

const newer = { model: 'gpt-6.2-sol', title: 'Cell Division' };

const latest = { model: 'gpt-6.3-sol', title: 'Chromosome Division' };

const english = catalogs.english;

const italian = catalogs.italian;

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
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.reload();
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
