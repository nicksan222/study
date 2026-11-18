import { StudyError } from '@study/contracts';
import { dictationSpacing } from '@study/ui';

export type TextSelection = { value: string; start: number; end: number };

export function textareaValue(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

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

  const { prefix, suffix } = dictationSpacing(before, text, after);
  const value = before + prefix + text + suffix + after;

  if (maxLength !== undefined && textareaValue(value).length > maxLength)
    throw new StudyError('invalid_input', 'Dictation exceeds the field length limit');

  return { value, caret: before.length + prefix.length + text.length };
}
