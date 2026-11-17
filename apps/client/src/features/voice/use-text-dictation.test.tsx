import { test } from '@study/testing';
import { useRef, useState } from 'react';

import { useTextDictation } from './use-text-dictation';

function Draft() {
  const [value, setValue] = useState('First idea');
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
    </>
  );
}

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
