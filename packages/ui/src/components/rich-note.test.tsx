import { test } from '@study/testing';
import { createRef } from 'react';

import { GenerationPreview } from './generation-preview';
import { RichNoteContent, RichNoteEditor } from './rich-note';
import type { RichNoteEditorHandle, RichNoteLabels } from './rich-note';

test.unit.stable(
  'typesets TeX before Markdown can consume delimiters or subscripts',
  ({ render, expect }) => {
    const view = render(
      <RichNoteContent
        value={String.raw`Uncertainty \(1/\sqrt{n}\), $x_i^2$ and **bold**.

\[\frac{a_b}{\sqrt{n}}\]

$$\sum_{i=1}^{n} x_i$$

${'`$literal$`'}

~~~tex
\sqrt{code}
~~~`}
      />
    );

    expect(view.container.querySelectorAll('math')).toHaveLength(4);
    expect(view.container.querySelector('msqrt')).not.toBeNull();
    expect(view.container.querySelector('mfrac')).not.toBeNull();
    expect(view.container.querySelector('strong')).toHaveTextContent('bold');
    expect(view.container.querySelector('code')).toHaveTextContent('$literal$');
    expect(view.container.querySelector('pre')).toHaveTextContent('\\sqrt{code}');
  }
);

test.unit.stable(
  'keeps incomplete math readable and rejects trusted HTML commands',
  ({ render, expect }) => {
    const view = render(
      <RichNoteContent value={String.raw`Partial \(\sqrt{ and $\href{javascript:alert(1)}{bad}$`} />
    );

    expect(view.container).toHaveTextContent('Partial');
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
  }
);

test.unit.stable(
  'formats live previews and preserves existing word nodes as text arrives',
  ({ render, expect }) => {
    const view = render(<GenerationPreview label="Generating" text="First word" />);
    const first = view.container.querySelector('[data-stream-word]');

    expect(first).not.toBeNull();
    view.rerender(
      <GenerationPreview label="Generating" text={'First word **next** $\\sqrt{n}$'} />
    );
    expect(view.container.querySelector('[data-stream-word]')).toBe(first);
    expect(view.container.querySelector('strong')).toHaveTextContent('next');
    expect(view.container.querySelector('math')).not.toBeNull();
    expect(view.container.querySelector('[role="status"]')).toHaveTextContent('Generating');
  }
);

test.unit.stable(
  'keeps currency, escaped dollars and math inside code literal',
  ({ render, expect }) => {
    const view = render(
      <RichNoteContent value={'Prices $5 and $10; \\$literal\\$; `\\(x\\)` and `$x$`.'} />
    );

    expect(view.container.querySelector('math')).toBeNull();
    expect(view.container).toHaveTextContent('Prices $5 and $10');
    expect(view.container.querySelectorAll('code')).toHaveLength(2);
  }
);

const editorLabels = new Proxy({} as RichNoteLabels, { get: (_, key) => String(key) });

for (const [latex, open, closing, savedFence] of [
  ['-x+y', '$$', '\n$$', '$$'],
  ['x % $$\n+y', '\\[', '\n\\]', '\\['],
  ['x % $$ in a comment\n+y', '\\[', '\n\\]', '$$'],
  ['x % $$\n+y % \\]', '\\[', '\\]', '\\['],
  ['x % \\]\n+y % $$', '$$', '$$', '$$']
]) {
  test.unit.stable(
    `preserves display formula ${JSON.stringify(latex)} when saving changed prose`,
    ({ render, act, expect }) => {
      const handle = createRef<RichNoteEditorHandle>();
      let saved = '';
      const view = render(
        <RichNoteEditor
          ref={handle}
          value={`${open}\n${latex}${closing}\n\nEnd`}
          onChange={(value) => {
            saved = value;
          }}
          label="Note"
          placeholder=""
          labels={editorLabels}
        />
      );

      expect(view.container.querySelector('[data-note-math]')?.textContent).toBe(latex);
      act(() => {
        handle.current!.insertPlainText('spoken', { append: true });
      });
      view.rerender(<RichNoteContent value={saved} />);
      expect(view.container.querySelector('.katex-error')).toBeNull();
      expect(view.container.querySelector('math annotation')?.textContent).toBe(latex);
      expect(view.container).toHaveTextContent('End spoken');
      expect(saved.startsWith(`${savedFence}\n`)).toBe(true);
    }
  );
}

test.unit.stable(
  'keeps existing Markdown URLs and email addresses clickable',
  ({ render, expect, screen }) => {
    render(
      <RichNoteContent value="See https://example.invalid or email learner@example.invalid." />
    );

    expect(screen.getByRole('link', { name: 'https://example.invalid' })).toHaveAttribute(
      'href',
      'https://example.invalid'
    );
    expect(screen.getByRole('link', { name: 'learner@example.invalid' })).toHaveAttribute(
      'href',
      'mailto:learner@example.invalid'
    );
  }
);

test.unit.stable(
  'keeps dictated URLs plain after saving and reopening',
  ({ render, act, expect }) => {
    const handle = createRef<RichNoteEditorHandle>();
    const text =
      'Visit https://example.invalid or www.example.invalid, or email me@example.invalid.';
    let saved = '';
    const props = {
      label: 'Note',
      placeholder: '',
      labels: editorLabels,
      onChange: (value: string) => {
        saved = value;
      }
    };
    const first = render(<RichNoteEditor {...props} ref={handle} value="" />);

    act(() => handle.current!.insertPlainText(text));
    expect(first.container.querySelector('.tiptap a')).toBeNull();
    first.unmount();
    const reopened = render(<RichNoteEditor {...props} value={saved} />);

    expect(reopened.container.querySelector('.tiptap a')).toBeNull();
    expect(reopened.container.querySelector('.tiptap')).toHaveTextContent(text);
  }
);

test.unit.stable(
  'keeps non-text blocks when restored dictation has no text cursor',
  ({ render, screen, act, expect }) => {
    const ref = createRef<RichNoteEditorHandle>();
    let saved = '';
    const props = {
      label: 'Note',
      placeholder: '',
      labels: editorLabels,
      onChange: (value: string) => {
        saved = value;
      }
    };
    const first = render(<RichNoteEditor {...props} ref={ref} value={'---\n\n---'} />);

    expect(first.container.querySelectorAll('.tiptap hr')).toHaveLength(2);
    act(() => {
      ref.current!.restoreSelection({
        kind: 'text',
        anchor: Number.MAX_SAFE_INTEGER,
        head: Number.MAX_SAFE_INTEGER
      });
      ref.current!.insertPlainText('Spoken paragraph');
    });
    expect(first.container.querySelectorAll('.tiptap hr')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveTextContent('Spoken paragraph');
    first.unmount();
    const reopened = render(<RichNoteEditor {...props} value={saved} />);

    expect(reopened.container.querySelectorAll('.tiptap hr')).toHaveLength(2);
    expect(reopened.container.querySelector('.tiptap > p')).toHaveTextContent('Spoken paragraph');
  }
);

for (const literal of [
  '1. January is the deadline',
  '# Title',
  '---',
  '- Monday',
  '+ Tuesday',
  '* Wednesday',
  '1) January',
  'Deadline\n===',
  'First\n# Title\n---',
  '$$x+y$$',
  '$$\nx+y\n$$'
]) {
  test.unit.stable(
    `preserves literal dictated paragraph ${JSON.stringify(literal)} after saving and reopening`,
    ({ render, screen, act, expect }) => {
      let saved = '';
      const ref = createRef<RichNoteEditorHandle>();
      const props = {
        label: 'Note',
        placeholder: '',
        labels: editorLabels,
        onChange: (next: string) => {
          saved = next;
        }
      };
      const first = render(<RichNoteEditor {...props} ref={ref} value="" />);

      act(() => ref.current!.insertPlainText(literal));
      expect(screen.getByRole('textbox', { name: 'Note' })).toHaveTextContent(
        literal.replaceAll('\n', '')
      );
      first.unmount();
      const reopened = render(<RichNoteEditor {...props} value={saved} />);

      expect(reopened.container.querySelectorAll('.tiptap > p')).toHaveLength(1);
      expect(screen.getByRole('textbox', { name: 'Note' })).toHaveTextContent(
        literal.replaceAll('\n', '')
      );
      expect(reopened.container.querySelector('.tiptap')).not.toHaveTextContent('\\');
      expect(
        reopened.container.querySelector(
          '.tiptap ol, .tiptap ul, .tiptap h1, .tiptap h2, .tiptap hr, .tiptap [data-note-math]'
        )
      ).toBeNull();
    }
  );
}

test.unit.stable(
  'preserves authored formatting and code when saving rich notes',
  ({ render, screen, act, expect }) => {
    const ref = createRef<RichNoteEditorHandle>();
    let saved = '';
    const value =
      '# Heading\n\n**Bold** and *italic*, [link](https://example.invalid/), and `# Title\n---`.\n\n---\n\n> Quoted text\n\n1. First\n2. Second\n\n```txt\n# Literal code\n1. January\n---\n```\n\nEnd';
    const props = {
      label: 'Note',
      placeholder: '',
      labels: editorLabels,
      onChange: (next: string) => {
        saved = next;
      }
    };
    const first = render(<RichNoteEditor {...props} ref={ref} value={value} />);

    act(() => {
      ref.current!.restoreSelection({
        kind: 'text',
        anchor: Number.MAX_SAFE_INTEGER,
        head: Number.MAX_SAFE_INTEGER
      });
      ref.current!.insertPlainText('added');
    });
    first.unmount();
    const reopened = render(<RichNoteEditor {...props} value={saved} />);

    expect(reopened.container.querySelector('.tiptap h1')).toHaveTextContent('Heading');
    expect(reopened.container.querySelector('.tiptap strong')).toHaveTextContent('Bold');
    expect(reopened.container.querySelector('.tiptap em')).toHaveTextContent('italic');
    expect(reopened.container.querySelector('.tiptap a')).toHaveAttribute(
      'href',
      'https://example.invalid/'
    );
    expect(reopened.container.querySelector('.tiptap p code')?.textContent).toBe('# Title ---');
    expect(reopened.container.querySelectorAll('.tiptap ol > li')).toHaveLength(2);
    expect(reopened.container.querySelector('.tiptap hr')).not.toBeNull();
    expect(reopened.container.querySelector('.tiptap blockquote')).toHaveTextContent('Quoted text');
    expect(reopened.container.querySelector('.tiptap pre code')?.textContent).toBe(
      '# Literal code\n1. January\n---'
    );
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveTextContent('End added');
  }
);
