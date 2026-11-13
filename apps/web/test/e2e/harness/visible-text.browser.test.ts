import { expect as assert } from 'vite-plus/test';

import { expect, testHarness } from './index.ts';

testHarness(
  'visible substring rejects clipped and obscured text inside one prewrapped paragraph',
  async ({ browserOwner }) => {
    const context = await (
      await browserOwner.get()
    ).newContext({ viewport: { width: 800, height: 600 } });

    try {
      const page = await context.newPage();

      await page.setContent(`
      <style>
        html { zoom: 1.25; }
        p { white-space: pre-wrap; margin: 0; font: 20px/30px monospace; }
        section { width: 300px; height: 90px; overflow: hidden; }
      </style>
      <section><p>Beginning is readable.\nSecond line.\nThird line.\nHidden conclusion.</p></section>
    `);
      const paragraph = page.locator('p');

      // The whole element passes ordinary visibility even though its final text is clipped.
      await expect(paragraph).toBeVisible();
      await expect(paragraph).toHaveVisibleText('Beginning is readable.');
      await assert(
        expect(paragraph).not.toHaveVisibleText('Beginning is readable.', { timeout: 100 })
      ).rejects.toThrow('fully visible');
      await assert(
        expect(paragraph).toHaveVisibleText('Hidden conclusion.', { timeout: 100 })
      ).rejects.toThrow('fully visible');
      await expect(paragraph).not.toHaveVisibleText('Hidden conclusion.');

      await page.setContent(
        '<p style="white-space:pre-wrap;width:120px;font:20px/30px monospace">Wrapped visible substring.</p>'
      );
      await expect(paragraph).toHaveVisibleText('Wrapped visible substring.');

      await page.setContent('<p>Visible <strong>across</strong> text nodes.</p>');
      await expect(paragraph).toHaveVisibleText('Visible across text nodes.');

      await page.setContent(
        '<p>Covered text.</p><div style="position:fixed;inset:0;background:white"></div>'
      );
      await assert(
        expect(paragraph).toHaveVisibleText('Covered text.', { timeout: 100 })
      ).rejects.toThrow('fully visible');

      await page.setContent('<p style="position:absolute;top:700px">Outside viewport.</p>');
      await assert(
        expect(paragraph).toHaveVisibleText('Outside viewport.', { timeout: 100 })
      ).rejects.toThrow('fully visible');

      await page.setContent('<p style="opacity:0">Invisible text.</p>');
      await expect(paragraph).not.toHaveVisibleText('Invisible text.');

      await page.setContent('<p>Repeated. Repeated.</p>');
      await assert(
        expect(paragraph).toHaveVisibleText('Repeated.', { timeout: 100 })
      ).rejects.toThrow('unique substring');
      await expect(paragraph).not.toHaveVisibleText('Absent.');
    } finally {
      await context.close();
    }
  }
);
