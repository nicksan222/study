import { test } from '@study/testing';

import type * as Controls from './model-controls';

let VoiceModelControls: typeof Controls.VoiceModelControls;

let failure: unknown;

test.unit.beforeEach(async ({ mock }) => {
  failure = undefined;
  const mutation = () => ({ isPending: false, isError: false, reset() {} });

  mock('@study/contracts/react', () => ({
    rpc: {
      voice: {
        status: {
          useQuery: () => ({ data: { state: 'missing' }, isPending: false, isError: false })
        },
        install: { useMutation: () => ({ ...mutation(), isError: true, error: failure }) },
        cancelInstall: { useMutation: mutation },
        remove: { useMutation: mutation }
      }
    }
  }));
  VoiceModelControls = (await import('./model-controls')).VoiceModelControls;
});

test.unit.stable(
  'does not present an intentionally cancelled transport download as a failure',
  ({ render, screen, expect }) => {
    failure = { kind: 'cancelled', message: 'Cancelled', retryAfterMs: null };
    render(<VoiceModelControls />);
    expect(
      screen.queryByText('Could not update the voice model. Check your connection and retry.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download model' })).toBeEnabled();
  }
);

test.unit.stable('still presents an actual download failure', ({ render, screen, expect }) => {
  failure = { kind: 'transient', message: 'Unavailable', retryAfterMs: null };
  render(<VoiceModelControls />);
  expect(
    screen.getByText('Could not update the voice model. Check your connection and retry.')
  ).toBeInTheDocument();
});
