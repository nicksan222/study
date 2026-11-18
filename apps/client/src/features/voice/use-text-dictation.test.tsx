import { test } from '@study/testing';
import { useRef, useState } from 'react';

import { useTextDictation } from './use-text-dictation';

function Draft({ initial = 'First idea' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  const dictation = useTextDictation({ value, onChange: setValue, input });

  return (
    <>
      <textarea
        ref={input}
        aria-label="Draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button onClick={dictation.onCaptureStart}>Capture</button>
      <button onClick={() => dictation.onTranscript('another thought')}>Finish</button>
      <button
        onClick={() => {
          dictation.onTranscript('another thought');
          dictation.onTranscript('with a detail');
        }}
      >
        Deliver two segments
      </button>
    </>
  );
}

test.unit.stable(
  'replaces only the selected text after a CRLF in the controlled draft',
  ({ render, screen, fireEvent, expect }) => {
    render(<Draft initial={'first\r\nsecond'} />);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;

    input.setSelectionRange(6, 12);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(input.value).toBe('first\nanother thought');
  }
);

test.unit.stable(
  'captures the intended selection before transcription finishes',
  ({ render, screen, fireEvent, expect }) => {
    render(<Draft />);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;

    input.setSelectionRange(6, 10);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(input.value).toBe('First another thought');
  }
);

test.unit.stable(
  'retains typing during capture instead of restoring the earlier draft',
  ({ render, screen, fireEvent, expect }) => {
    render(<Draft />);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;

    input.setSelectionRange(0, 10);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.change(input, { target: { value: 'New writing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(input.value).toBe('New writing another thought');
  }
);

test.unit.stable(
  'replaces the selection once and inserts both segments in order in the same render',
  ({ render, screen, fireEvent, expect }) => {
    render(<Draft />);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;

    input.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deliver two segments' }));
    expect(input.value).toBe('another thought with a detail idea');
  }
);

test.unit.stable(
  'retains a user edit between dictated segments',
  ({ render, screen, fireEvent, expect }) => {
    render(<Draft />);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;
    const finish = screen.getByRole('button', { name: 'Finish' });

    input.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(finish);
    expect(input.value).toBe('another thought idea');
    fireEvent.change(input, { target: { value: 'A new idea with the first segment' } });
    fireEvent.click(finish);
    expect(input.value).toBe('A new idea with the first segment another thought');
  }
);

test.unit.stable(
  'does not restore a delivered segment that the user erased',
  ({ render, screen, fireEvent, expect }) => {
    render(<Draft />);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement;
    const finish = screen.getByRole('button', { name: 'Finish' });

    input.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    fireEvent.click(finish);
    expect(input.value).toBe('another thought idea');
    fireEvent.change(input, { target: { value: 'First idea' } });
    fireEvent.click(finish);
    expect(input.value).toBe('First idea another thought');
  }
);
