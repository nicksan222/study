import { test } from '@study/testing';

import { DictationSession } from './session';
import {
  DictationSubmissionScope,
  useDictationSubmission,
  useDictationSubmissionOwner
} from './submission';

function Owner({ session, owner }: { session: DictationSession; owner: symbol }) {
  useDictationSubmissionOwner(owner, session);

  return null;
}

function Destination({
  session,
  owner,
  label,
  submit
}: {
  session: DictationSession;
  owner: symbol;
  label: string;
  submit: () => void;
}) {
  const guard = useDictationSubmission();
  const save = () => {
    if (!guard.isBlocked()) submit();
  };

  return (
    <DictationSubmissionScope value={guard.scope}>
      <Owner owner={owner} session={session} />
      <textarea
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
      />
      <button type="button" disabled={guard.blocked} onClick={save}>
        {label}
      </button>
    </DictationSubmissionScope>
  );
}

test.unit.stable(
  'guards both submission paths only for the destination with unfinished dictation',
  async ({ render, screen, fireEvent, expect, act, vi }) => {
    const requested = Promise.withResolvers<void>();
    const response = Promise.withResolvers<{ text: string }>();
    const transcript = vi.fn();
    const session = new DictationSession(
      async () => ({ stop: async () => [0.5], cancel: () => {} }),
      () => {
        requested.resolve();

        return response.promise;
      }
    );
    const owner = Symbol();
    const submit = vi.fn();
    const submitOther = vi.fn();

    render(
      <>
        <Destination session={session} owner={owner} label="Draft" submit={submit} />
        <Destination session={session} owner={Symbol()} label="Other" submit={submitOther} />
      </>
    );
    const save = screen.getByRole('button', { name: 'Draft' });
    const input = screen.getByRole('textbox', { name: 'Draft' });
    const other = screen.getByRole('button', { name: 'Other' });

    await act(() => session.start(owner, transcript));
    expect(save).toBeDisabled();
    const stopping = session.stop(owner);

    await act(() => requested.promise);
    fireEvent.click(save);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(other);
    expect(submitOther).toHaveBeenCalledOnce();
    await act(async () => {
      response.resolve({ text: 'The final words' });
      await stopping;
    });
    expect(transcript).toHaveBeenCalledWith('The final words');
    expect(save).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledOnce();
  }
);
