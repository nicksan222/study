import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useRangeControl(
  value: number,
  disabled: boolean,
  onCommit: (value: number) => void
) {
  const [draft, setDraft] = useState(value);
  const submitted = useRef(value);

  const [lastValue, setLastValue] = useState(value);
  const [wasDisabled, setWasDisabled] = useState(disabled);

  // Reconcile controlled values after a save or failure without a second effect render.
  const changed = lastValue !== value || wasDisabled !== disabled;

  if (changed) {
    setLastValue(value);
    setWasDisabled(disabled);
  }

  if (changed && !disabled) setDraft(value);

  useEffect(() => {
    if (!disabled) submitted.current = value;
  }, [value, disabled]);

  function commit(next = draft) {
    commitValue(next, submitted, disabled, onCommit);
  }

  return { draft, setDraft, commit };
}

function commitValue(
  next: number,
  submitted: RefObject<number>,
  disabled: boolean,
  onCommit: (value: number) => void
) {
  if (next === submitted.current || disabled) return;

  submitted.current = next;
  onCommit(next);
}
