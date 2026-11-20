import type { Locator } from 'playwright';

/** Position the native caret at a block boundary independently of line wrapping. */
export async function placeCaretAtEnd(block: Locator) {
  await block.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    const selection = element.ownerDocument.getSelection();

    if (!selection) throw new Error('The editor has no active selection');

    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}
