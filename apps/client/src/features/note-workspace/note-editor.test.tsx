import { testStable } from '@study/testing/vitest';
import { RichNoteContent, RichNoteEditor } from '@study/ui/rich-note';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

const labels = {
  formatting: 'Format',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strike',
  paragraph: 'Normal text',
  textStyle: 'Text style',
  clear: 'Clear formatting',
  heading: 'Heading',
  subheading: 'Subheading',
  bullets: 'Bullets',
  numbered: 'Numbered',
  quote: 'Quote',
  code: 'Code',
  undo: 'Undo',
  redo: 'Redo'
};

testStable(
  'renders saved Markdown as a document with headings, lists, emphasis and safe links',
  () => {
    render(
      <RichNoteContent
        value={'# Notes\n\n- **Important**\n- Another idea\n\n[Unsafe](javascript:alert(1))'}
      />
    );
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Important').tagName).toBe('STRONG');
    expect(screen.getByText('Unsafe').closest('a')?.getAttribute('href') ?? '').not.toMatch(
      /^javascript:/i
    );
  }
);

testStable(
  'serializes formatting into Markdown and accepts external updates without echoing them',
  async () => {
    const onChange = vi.fn();
    const props = {
      value: 'A thought',
      label: 'Page',
      placeholder: 'Write here',
      labels,
      onChange
    };
    const view = render(<RichNoteEditor {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Text style' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Heading' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/^# A thought\n*$/))
    );
    expect(screen.getByRole('heading', { name: 'A thought' })).toBeInTheDocument();
    onChange.mockClear();
    view.rerender(<RichNoteEditor {...props} value={'## Reopened\n\nA **saved** page'} disabled />);
    expect(screen.getByRole('heading', { name: 'Reopened' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Page' })).toHaveAttribute(
      'contenteditable',
      'false'
    );
    expect(onChange).not.toHaveBeenCalled();
  }
);

testStable('applies writing preferences to the editable document without changing its text', () => {
  const onChange = vi.fn();
  const props = { value: 'A thought', label: 'Page', placeholder: 'Write here', labels, onChange };
  const view = render(<RichNoteEditor {...props} spellcheck={false} fontSize={22} />);
  const editor = screen.getByRole('textbox', { name: 'Page' });

  expect(editor).toHaveAttribute('spellcheck', 'false');
  expect(editor).toHaveStyle({ fontSize: '22px' });
  view.rerender(<RichNoteEditor {...props} spellcheck fontSize={16} />);
  expect(editor).toHaveAttribute('spellcheck', 'true');
  expect(editor).toHaveStyle({ fontSize: '16px' });
  expect(onChange).not.toHaveBeenCalled();
});
