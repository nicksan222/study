import { test } from '@study/testing';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { insertEditorText } from './editor-text';

test.unit.stable(
  'inserts dictated text literally at selection with line breaks and undo',
  ({ expect }) => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Hello world</p>' });

    try {
      editor.commands.setTextSelection({ from: 7, to: 12 });
      insertEditorText(editor, '<b>literal</b>\nnext');
      expect(editor.getText()).toBe('Hello <b>literal</b>\nnext');
      expect(editor.getHTML()).toContain('&lt;b&gt;literal&lt;/b&gt;');
      expect(editor.getHTML()).not.toContain('<b>');
      editor.commands.undo();
      expect(editor.getText()).toBe('Hello world');
    } finally {
      editor.destroy();
    }
  }
);

test.unit.stable(
  'separates dictated prose from adjacent text at a collapsed caret',
  ({ expect }) => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>First</p>' });

    try {
      editor.commands.setTextSelection(6);
      insertEditorText(editor, 'next');
      expect(editor.getText()).toBe('First next');
    } finally {
      editor.destroy();
    }
  }
);
