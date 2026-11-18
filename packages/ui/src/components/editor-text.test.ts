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

for (const newline of ['\n', '\r\n', '\r']) {
  test.unit.stable(
    `preserves literal multiline dictation in code blocks with ${JSON.stringify(newline)} separators`,
    ({ expect }) => {
      const editor = new Editor({
        extensions: [StarterKit],
        content: '<pre><code>Before selected after</code></pre>'
      });

      try {
        editor.commands.setTextSelection({ from: 8, to: 16 });
        const before = editor.getJSON();

        insertEditorText(editor, `<tag>${newline}second${newline}${newline}last`);
        expect(editor.getJSON().content?.[0]).toMatchObject({
          type: 'codeBlock',
          content: [{ type: 'text', text: 'Before <tag>\nsecond\n\nlast after' }]
        });
        editor.commands.undo();
        expect(editor.getJSON()).toEqual(before);
      } finally {
        editor.destroy();
      }
    }
  );
}
