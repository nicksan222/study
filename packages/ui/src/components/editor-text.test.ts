import { test } from '@study/testing';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { insertEditorText } from './editor-text';

for (const [open, close, padding] of [
  ['(', ')', ''],
  ['“', '”', ''],
  ['‘', '’', ''],
  ['«', '»', ''],
  ['"', '"', ' ']
]) {
  test.unit.stable(`preserves dictation spacing between ${open} and ${close}`, ({ expect }) => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: `<p>Keep ${open}old${close} here</p>`
    });

    try {
      editor.commands.setTextSelection({ from: 7, to: 10 });
      insertEditorText(editor, 'new');
      insertEditorText(editor, 'words', { continuation: true });
      expect(editor.getText()).toBe(`Keep ${open}${padding}new words${padding}${close} here`);
    } finally {
      editor.destroy();
    }
  });
}

test.unit.stable(
  'keeps selected non-text blocks and undoes dictation in one step',
  ({ expect }) => {
    const editor = new Editor({ extensions: [StarterKit], content: '<hr><hr>' });

    try {
      editor.commands.setNodeSelection(1);
      const before = editor.getJSON();

      insertEditorText(editor, 'Spoken\r\nparagraph');
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        'horizontalRule',
        'horizontalRule',
        'paragraph',
        'paragraph'
      ]);
      expect(editor.getText()).toContain('Spoken\nparagraph');
      editor.commands.undo();
      expect(editor.getJSON()).toEqual(before);
    } finally {
      editor.destroy();
    }
  }
);

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

test.unit.stable(
  'continues multiline dictation in the code block at the end of a text selection',
  ({ expect }) => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>Before</p><pre><code>Code end</code></pre><p>After</p>'
    });

    try {
      const { doc } = editor.state;
      const end = doc.child(0).nodeSize + doc.child(1).nodeSize - 1;

      editor.commands.setTextSelection({ from: 2, to: end });
      insertEditorText(editor, 'first\r\nsecond', { continuation: true });
      expect(editor.getJSON().content).toMatchObject([
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'Code end first\nsecond' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }
      ]);
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
