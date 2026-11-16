import { test } from '@study/testing';
import { RichNoteContent, RichNoteEditor } from '@study/ui';

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

test.stable(
  'renders saved Markdown as a document with headings, lists, emphasis and safe links',
  () => {
    test.render(
      <RichNoteContent
        value={'# Notes\n\n- **Important**\n- Another idea\n\n[Unsafe](javascript:alert(1))'}
      />
    );
    test.expect(test.screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    test.expect(test.screen.getAllByRole('listitem')).toHaveLength(2);
    test.expect(test.screen.getByText('Important').tagName).toBe('STRONG');
    test
      .expect(test.screen.getByText('Unsafe').closest('a')?.getAttribute('href') ?? '')
      .not.toMatch(/^javascript:/i);
  }
);

test.stable(
  'serializes formatting into Markdown and accepts external updates without echoing them',
  async () => {
    const onChange = test.vi.fn();
    const props = {
      value: 'A thought',
      label: 'Page',
      placeholder: 'Write here',
      labels,
      onChange
    };
    const view = test.render(<RichNoteEditor {...props} />);

    test.fireEvent.click(test.screen.getByRole('button', { name: 'Text style' }));
    test.fireEvent.click(await test.screen.findByRole('menuitem', { name: 'Heading' }));
    await test.waitFor(() =>
      test.expect(onChange).toHaveBeenLastCalledWith(test.expect.stringMatching(/^# A thought\n*$/))
    );
    test.expect(test.screen.getByRole('heading', { name: 'A thought' })).toBeInTheDocument();
    onChange.mockClear();
    view.rerender(<RichNoteEditor {...props} value={'## Reopened\n\nA **saved** page'} disabled />);
    test.expect(test.screen.getByRole('heading', { name: 'Reopened' })).toBeInTheDocument();
    test
      .expect(test.screen.getByRole('textbox', { name: 'Page' }))
      .toHaveAttribute('contenteditable', 'false');
    test.expect(onChange).not.toHaveBeenCalled();
  }
);

test.stable(
  'applies writing preferences to the editable document without changing its text',
  () => {
    const onChange = test.vi.fn();
    const props = {
      value: 'A thought',
      label: 'Page',
      placeholder: 'Write here',
      labels,
      onChange
    };
    const view = test.render(<RichNoteEditor {...props} spellcheck={false} fontSize={22} />);
    const editor = test.screen.getByRole('textbox', { name: 'Page' });

    test.expect(editor).toHaveAttribute('spellcheck', 'false');
    test.expect(editor).toHaveStyle({ fontSize: '22px' });
    view.rerender(<RichNoteEditor {...props} spellcheck fontSize={16} />);
    test.expect(editor).toHaveAttribute('spellcheck', 'true');
    test.expect(editor).toHaveStyle({ fontSize: '16px' });
    test.expect(onChange).not.toHaveBeenCalled();
  }
);
