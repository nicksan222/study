import { StudyError } from '@study/contracts';

export type TextSelection = { value: string; start: number; end: number };

/** A changed draft keeps every edit; an unchanged draft accepts the captured selection. */
export function insertTranscript(
  current: string,
  transcript: string,
  selection?: TextSelection,
  maxLength?: number
) {
  const unchanged = selection?.value === current;
  const start = unchanged ? selection.start : current.length;
  const end = unchanged ? selection.end : current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const text = transcript.trim();

  if (!text) return { value: current, caret: start };

  const { prefix, suffix } = transcriptSpacing(before, after, text);
  const value = before + prefix + text + suffix + after;

  if (maxLength !== undefined && value.length > maxLength)
    throw new StudyError('invalid_input', 'Dictation exceeds the field length limit');

  return { value, caret: before.length + prefix.length + text.length };
}

function transcriptSpacing(before: string, after: string, text: string) {
  return {
    prefix: before && !/\s$/.test(before) && !/^[,.;:!?]/.test(text) ? ' ' : '',
    suffix: after && !/^[\s,.;:!?]/.test(after) ? ' ' : ''
  };
}
