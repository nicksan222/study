import { test } from '@study/testing';

import { GenerationPreview } from './generation-preview';
import { RichNoteContent } from './rich-note';

test.stable('typesets TeX before Markdown can consume delimiters or subscripts', () => {
  const view = test.render(
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

  test.expect(view.container.querySelectorAll('math')).toHaveLength(4);
  test.expect(view.container.querySelector('msqrt')).not.toBeNull();
  test.expect(view.container.querySelector('mfrac')).not.toBeNull();
  test.expect(view.container.querySelector('strong')).toHaveTextContent('bold');
  test.expect(view.container.querySelector('code')).toHaveTextContent('$literal$');
  test.expect(view.container.querySelector('pre')).toHaveTextContent('\\sqrt{code}');
});

test.stable('keeps incomplete math readable and rejects trusted HTML commands', () => {
  const view = test.render(
    <RichNoteContent value={String.raw`Partial \(\sqrt{ and $\href{javascript:alert(1)}{bad}$`} />
  );

  test.expect(view.container).toHaveTextContent('Partial');
  test.expect(view.container.querySelector('a')).toBeNull();
  test.expect(view.container.querySelector('script')).toBeNull();
});

test.stable('formats live previews and preserves existing word nodes as text arrives', () => {
  const view = test.render(<GenerationPreview label="Generating" text="First word" />);
  const first = view.container.querySelector('[data-stream-word]');

  test.expect(first).not.toBeNull();
  view.rerender(<GenerationPreview label="Generating" text={'First word **next** $\\sqrt{n}$'} />);
  test.expect(view.container.querySelector('[data-stream-word]')).toBe(first);
  test.expect(view.container.querySelector('strong')).toHaveTextContent('next');
  test.expect(view.container.querySelector('math')).not.toBeNull();
  test.expect(view.container.querySelector('[role="status"]')).toHaveTextContent('Generating');
});

test.stable('keeps currency, escaped dollars and math inside code literal', () => {
  const view = test.render(
    <RichNoteContent value={'Prices $5 and $10; \\$literal\\$; `\\(x\\)` and `$x$`.'} />
  );

  test.expect(view.container.querySelector('math')).toBeNull();
  test.expect(view.container).toHaveTextContent('Prices $5 and $10');
  test.expect(view.container.querySelectorAll('code')).toHaveLength(2);
});
