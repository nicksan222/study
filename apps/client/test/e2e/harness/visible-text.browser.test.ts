import { test } from '@study/testing';

test.stable(
  'visible substring rejects clipped and obscured text inside one prewrapped paragraph',
  async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });

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
    await test.expect(paragraph).toBeVisible();
    await test.expect(paragraph).toHaveVisibleText('Beginning is readable.');
    await test
      .expect(
        test.expect(paragraph).not.toHaveVisibleText('Beginning is readable.', { timeout: 100 })
      )
      .rejects.toThrow('fully visible');
    await test
      .expect(test.expect(paragraph).toHaveVisibleText('Hidden conclusion.', { timeout: 100 }))
      .rejects.toThrow('fully visible');
    await test.expect(paragraph).not.toHaveVisibleText('Hidden conclusion.');

    await page.setContent(
      '<p style="white-space:pre-wrap;width:120px;font:20px/30px monospace">Wrapped visible substring.</p>'
    );
    await test.expect(paragraph).toHaveVisibleText('Wrapped visible substring.');

    await page.setContent('<p>Visible <strong>across</strong> text nodes.</p>');
    await test.expect(paragraph).toHaveVisibleText('Visible across text nodes.');

    await page.setContent(
      '<p>Covered text.</p><div style="position:fixed;inset:0;background:white"></div>'
    );
    await test
      .expect(test.expect(paragraph).toHaveVisibleText('Covered text.', { timeout: 100 }))
      .rejects.toThrow('fully visible');

    await page.setContent('<p style="position:absolute;top:700px">Outside viewport.</p>');
    await test
      .expect(test.expect(paragraph).toHaveVisibleText('Outside viewport.', { timeout: 100 }))
      .rejects.toThrow('fully visible');

    await page.setContent('<p style="opacity:0">Invisible text.</p>');
    await test.expect(paragraph).not.toHaveVisibleText('Invisible text.');

    await page.setContent('<p>Repeated. Repeated.</p>');
    await test
      .expect(test.expect(paragraph).toHaveVisibleText('Repeated.', { timeout: 100 }))
      .rejects.toThrow('unique substring');
    await test.expect(paragraph).not.toHaveVisibleText('Absent.');
  }
);
