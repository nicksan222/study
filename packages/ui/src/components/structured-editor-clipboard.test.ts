import { test } from '@study/testing';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { copyEditorSelection } from './structured-editor-clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

test.afterEach(() => {
  test.vi.unstubAllGlobals();

  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  test.vi.stubGlobal('ClipboardItem', undefined);
}

test.stable(
  'cuts only after the clipboard accepts the selected content and keeps native undo',
  async () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Selected neighbor</p>' });

    clipboard(async () => undefined);

    try {
      editor.commands.setTextSelection({ from: 1, to: 9 });
      await copyEditorSelection(editor, true);
      test.expect(editor.getText()).toBe(' neighbor');
      editor.commands.undo();
      test.expect(editor.getText()).toBe('Selected neighbor');
    } finally {
      editor.destroy();
    }
  }
);

test.stable('retains selected content when clipboard permission is denied', async () => {
  const editor = new Editor({ extensions: [StarterKit], content: '<p>Keep this text</p>' });

  clipboard(async () => {
    throw new Error('Permission denied');
  });

  try {
    editor.commands.selectAll();
    await test.expect(copyEditorSelection(editor, true)).rejects.toThrow();
    test.expect(editor.getText()).toBe('Keep this text');
  } finally {
    editor.destroy();
  }
});

test.stable(
  'keeps content when editing is disabled while clipboard permission is pending',
  async () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Keep this text</p>' });
    let accept: () => void = () => undefined;

    clipboard(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        })
    );

    try {
      editor.commands.selectAll();
      const cutting = copyEditorSelection(editor, true);

      editor.setEditable(false);
      accept();
      await cutting;
      test.expect(editor.getText()).toBe('Keep this text');
    } finally {
      editor.destroy();
    }
  }
);
