import { replyInputSchema, replyOutputSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.browser.use({ aiEnabled: true });

const copy = catalogs.english;

const assistant = { id: 'assistant', input: replyInputSchema, output: replyOutputSchema };

test.browser.stable(
  'Assistant restores a saved reply and keeps new chats separate',
  async ({ page, study, ai, expect, expectScreenshot }) => {
    await study.notes.seed();
    const firstQuestion = 'How does condensation form clouds?';
    const firstTitle = 'Water droplets in clouds';
    const secondQuestion = 'What causes tides?';
    const secondAnswer = 'The Moon’s gravity is the main driver of tides.';

    ai.next(assistant, {
      input: { messages: [{ role: 'user', content: firstQuestion }] },
      output: `## ${firstTitle}\n\nCooling water vapor condenses into small droplets.`
    });
    ai.next(assistant, {
      input: { messages: [{ role: 'user', content: secondQuestion }] },
      output: secondAnswer
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/assistant');
    const main = page.getByRole('main');
    const composer = main.getByRole('textbox', { name: copy.StudyChatMessage, exact: true });
    const send = main.getByRole('button', { name: copy.SendMessage, exact: true });
    const conversation = main.getByRole('log', { name: copy.Assistant, exact: true });
    const firstReply = conversation.getByRole('heading', { name: firstTitle, exact: true });

    await composer.fill(firstQuestion);
    await send.click();
    await expect(firstReply).toBeVisible();
    await expect(main.getByRole('button', { name: copy.CopyText, exact: true })).toBeVisible();

    await page.reload();
    await expect(conversation.getByText(firstQuestion, { exact: true })).toBeVisible();
    await expect(firstReply).toBeVisible();
    const historyToggle = main.getByRole('button', { name: copy.AssistantHistory, exact: true });

    await historyToggle.click();
    const history = main.getByRole('navigation', { name: copy.AssistantHistory, exact: true });
    const firstChat = history.getByRole('button', { name: firstQuestion, exact: true });

    await expectScreenshot('reopened-chat', {
      target: 'viewport',
      ready: () => expect(firstChat).toHaveAttribute('aria-current', 'page')
    });
    await main.getByRole('button', { name: copy.AssistantNewChat, exact: true }).click();
    await expect(main.getByRole('heading', { name: copy.StudyChatEmptyTitle })).toBeVisible();
    await expect(firstReply).toBeHidden();
    await expect(composer).toBeEmpty();
    await composer.fill(secondQuestion);
    await send.click();
    const secondReply = main.getByText(secondAnswer, { exact: true });

    await expect(secondReply).toBeVisible();
    await expect(firstReply).toBeHidden();
    await firstChat.press('Enter');
    await expect(history).toBeHidden();
    await expect(historyToggle).toBeFocused();
    await expect(firstReply).toBeVisible();
    await expect(secondReply).toBeHidden();
  }
);
