import { test } from '@study/testing';

import type * as Controls from './model-controls';

let VoiceModelControls: typeof Controls.VoiceModelControls;

let VoiceLanguageRow: typeof Controls.VoiceLanguageRow;

let failure: unknown;

test.unit.beforeEach(async ({ mock }) => {
  failure = undefined;
  const mutation = () => ({ isPending: false, isError: false, reset() {} });

  mock('@study/contracts/react', () => ({
    rpc: {
      voice: {
        status: {
          useQuery: () => ({
            data: {
              state: 'missing',
              modelId: 'active',
              models: [
                {
                  id: 'other',
                  name: 'Other recognizer',
                  languages: ['de', 'en', 'fr'],
                  languageDetection: 'automatic'
                },
                {
                  id: 'active',
                  name: 'Active recognizer',
                  languages: ['it'],
                  languageDetection: 'automatic'
                }
              ]
            },
            isPending: false,
            isError: false
          })
        },
        install: { useMutation: () => ({ ...mutation(), isError: true, error: failure }) },
        cancelInstall: { useMutation: mutation },
        remove: { useMutation: mutation }
      }
    }
  }));
  ({ VoiceModelControls, VoiceLanguageRow } = await import('./model-controls'));
});

test.unit.stable(
  'uses the active server model rather than the first catalog entry',
  ({ render, screen, expect }) => {
    render(
      <>
        <VoiceModelControls />
        <VoiceLanguageRow />
      </>
    );
    expect(screen.getByText('Recognition model: Active recognizer')).toBeInTheDocument();
    expect(screen.queryByText('Recognition model: Other recognizer')).not.toBeInTheDocument();
    expect(screen.getByText(/1 supported language\./)).toBeInTheDocument();
    expect(screen.getByText('Automatic detection')).toBeInTheDocument();
  }
);

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
