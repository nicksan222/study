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

export async function selectEditorText(editor: Locator, excerpt: string) {
  await editor.focus();
  await editor.evaluate((element, selectedText) => {
    const node = element.querySelector('p')?.firstChild;
    const selection = element.ownerDocument.getSelection();
    const start = node?.textContent?.indexOf(selectedText) ?? -1;

    if (node?.nodeType !== Node.TEXT_NODE || !selection || start < 0)
      throw new Error('The notebook could not select the expected words');

    selection.setBaseAndExtent(node, start, node, start + selectedText.length);
  }, excerpt);
}
