import { testStable } from '@study/testing/vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, vi } from 'vite-plus/test';

import { copyEditorSelection } from './structured-editor-clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.stubGlobal('ClipboardItem', undefined);
}

testStable(
  'cuts only after the clipboard accepts the selected content and keeps native undo',
  async () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Selected neighbor</p>' });
    clipboard(async () => undefined);

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

testStable('retains selected content when clipboard permission is denied', async () => {
  const editor = new Editor({ extensions: [StarterKit], content: '<p>Keep this text</p>' });
  clipboard(async () => {
    throw new Error('Permission denied');
  });

  try {
    editor.commands.selectAll();
    await expect(copyEditorSelection(editor, true)).rejects.toThrow();
    expect(editor.getText()).toBe('Keep this text');
  } finally {
    editor.destroy();
  }
});

testStable(
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
      expect(editor.getText()).toBe('Keep this text');
    } finally {
      editor.destroy();
    }
  }
);
