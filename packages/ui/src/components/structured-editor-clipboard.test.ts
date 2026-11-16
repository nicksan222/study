import { test } from '@study/testing';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { copyEditorSelection } from './structured-editor-clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

test.unit.afterEach(({ vi }) => {
  vi.unstubAllGlobals();

  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function clipboard(
  { vi }: Pick<test.unit.Context, 'vi'>,
  writeText: (text: string) => Promise<void>
) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.stubGlobal('ClipboardItem', undefined);
}

test.unit.stable(
  'cuts only after the clipboard accepts the selected content and keeps native undo',
  async ({ expect, vi }) => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Selected neighbor</p>' });

    clipboard({ vi }, async () => undefined);

    try {
      editor.commands.setTextSelection({ from: 1, to: 9 });
      await copyEditorSelection(editor, true);
      expect(editor.getText()).toBe(' neighbor');
      editor.commands.undo();
      expect(editor.getText()).toBe('Selected neighbor');
    } finally {
      editor.destroy();
    }
  }
);

test.unit.stable(
  'retains selected content when clipboard permission is denied',
  async ({ expect, vi }) => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Keep this text</p>' });

    clipboard({ vi }, async () => {
      throw new Error('Permission denied');
    });

    try {
      editor.commands.selectAll();
      await expect(copyEditorSelection(editor, true)).rejects.toThrow();
      expect(editor.getText()).toBe('Keep this text');
    } finally {
      editor.destroy();
    }
  }
);

test.unit.stable(
  'keeps content when editing is disabled while clipboard permission is pending',
  async ({ expect, vi }) => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Keep this text</p>' });
    let accept: () => void = () => undefined;

    clipboard(
      { vi },
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
      expect(editor.getText()).toBe('Keep this text');
    } finally {
      editor.destroy();
    }
  }
);
