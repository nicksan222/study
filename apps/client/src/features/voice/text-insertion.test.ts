import { test } from '@study/testing';

import { insertTranscript } from './text-insertion';

test.unit.stable('keeps parentheses adjacent to the dictated replacement', ({ expect }) => {
  const value = 'Keep (old) here';

  expect(insertTranscript(value, 'new', { value, start: 6, end: 9 })).toEqual({
    value: 'Keep (new) here',
    caret: 9
  });
});

test.unit.stable(
  'replaces only the captured selection and separates dictated words',
  ({ expect }) => {
    expect(
      insertTranscript('Hello world!', 'new words', { value: 'Hello world!', start: 6, end: 11 })
    ).toEqual({ value: 'Hello new words!', caret: 15 });
  }
);

test.unit.stable('preserves edits made during recognition and appends dictation', ({ expect }) => {
  expect(
    insertTranscript('Changed draft', 'more words', { value: 'Old draft', start: 0, end: 3 })
  ).toEqual({ value: 'Changed draft more words', caret: 24 });
});

test.unit.stable(
  'keeps dictated markup literal and refuses overflow without losing text',
  ({ expect }) => {
    expect(insertTranscript('', '<b>literal</b>', undefined)).toEqual({
      value: '<b>literal</b>',
      caret: 14
    });
    expect(() => insertTranscript('Full', 'extra', undefined, 5)).toThrow();
  }
);

test.unit.stable('keeps the draft when recognition contains only whitespace', ({ expect }) => {
  expect(insertTranscript('Keep this', '   ', { value: 'Keep this', start: 0, end: 9 })).toEqual({
    value: 'Keep this',
    caret: 0
  });
});

test.unit.stable(
  'counts newlines as the textarea does while preserving splice offsets',
  ({ expect }) => {
    const initial = 'a\r\n';
    const first = insertTranscript(initial, 'b', undefined, 5);

    expect(first).toEqual({ value: 'a\r\nb', caret: 4 });
    const selection = { value: first.value, start: first.caret, end: first.caret };

    expect(insertTranscript(first.value, 'c', selection, 5)).toEqual({
      value: 'a\r\nb c',
      caret: 6
    });
    expect(() => insertTranscript(first.value, 'cd', selection, 5)).toThrow();
  }
);
