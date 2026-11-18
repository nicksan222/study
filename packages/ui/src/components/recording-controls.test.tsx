import { test } from '@study/testing';

import { RecordingFeedback } from './recording-controls';

test.unit.stable(
  'shows the elapsed recording time and resets it for the next capture',
  async ({ act, expect, render, screen, vi }) => {
    const props = {
      disabled: false,
      finishLabel: 'Finish',
      recordingLabel: 'Recording',
      onFinish: () => {},
      subscribeLevel: () => () => {}
    };

    vi.useFakeTimers();

    try {
      const view = render(<RecordingFeedback {...props} />);

      expect(screen.getByText('0:00')).toBeVisible();
      await act(async () => vi.advanceTimersByTimeAsync(6_000));
      expect(screen.getByText('0:06')).toBeVisible();
      view.rerender(<RecordingFeedback {...props} progress="Transcribing" />);
      expect(screen.queryByText('0:06')).not.toBeInTheDocument();
      view.rerender(<RecordingFeedback {...props} />);
      expect(screen.getByText('0:00')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  }
);
