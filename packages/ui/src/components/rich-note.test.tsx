import { testStable } from '@study/testing/vitest';
import { render } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { GenerationPreview } from './generation-preview';
import { RichNoteContent } from './rich-note';

testStable('typesets TeX before Markdown can consume delimiters or subscripts', () => {
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
});

testStable('keeps incomplete math readable and rejects trusted HTML commands', () => {
  const view = render(
    <RichNoteContent value={String.raw`Partial \(\sqrt{ and $\href{javascript:alert(1)}{bad}$`} />
  );

  expect(view.container).toHaveTextContent('Partial');
  expect(view.container.querySelector('a')).toBeNull();
  expect(view.container.querySelector('script')).toBeNull();
});

testStable('formats live previews and preserves existing word nodes as text arrives', () => {
  const view = render(<GenerationPreview label="Generating" text="First word" />);
  const first = view.container.querySelector('[data-stream-word]');

  expect(first).not.toBeNull();
  view.rerender(<GenerationPreview label="Generating" text={'First word **next** $\\sqrt{n}$'} />);
  expect(view.container.querySelector('[data-stream-word]')).toBe(first);
  expect(view.container.querySelector('strong')).toHaveTextContent('next');
  expect(view.container.querySelector('math')).not.toBeNull();
  expect(view.container.querySelector('[role="status"]')).toHaveTextContent('Generating');
});

testStable('keeps currency, escaped dollars and math inside code literal', () => {
  const view = render(
    <RichNoteContent value={'Prices $5 and $10; \\$literal\\$; `\\(x\\)` and `$x$`.'} />
  );

  expect(view.container.querySelector('math')).toBeNull();
  expect(view.container).toHaveTextContent('Prices $5 and $10');
  expect(view.container.querySelectorAll('code')).toHaveLength(2);
});
