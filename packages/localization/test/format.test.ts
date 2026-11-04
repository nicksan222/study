import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { catalogs } from '../src/catalog.ts';
import {
  text,
  joined,
  choiceLabel,
  materialFileName,
  mediaSize,
  secondsTaken
} from '../src/index.ts';
testStable('catalog and formatting match the Rust examples', () => {
  assert.strictEqual(text('italian', 'Home'), 'Panoramica');
  assert.strictEqual(joined(['Question 1', '', 'PDF']), 'Question 1 · PDF');
  assert.strictEqual(choiceLabel(1, 'Ribosomes'), 'B. Ribosomes');
  assert.strictEqual(
    materialFileName('english', 'Cells / ATP: why?', 'svg'),
    'Cells   ATP  why.svg'
  );
  assert.strictEqual(materialFileName('italian', '*', 'md'), 'Senza titolo.md');
  assert.strictEqual(mediaSize('english', 1048524), '1023.9 KiB');
  assert.strictEqual(mediaSize('english', 1048525), '1.0 MiB');
  assert.strictEqual(secondsTaken('italian', 4.2), '4,2 s');
});

import {
  fileCount,
  sourceCount,
  examCountdown,
  practiceFigure,
  age,
  dayLabel,
  moment,
  recordingClock,
  pastedImageName,
  anchorLabel,
  citationLabel,
  mentionSuggestions
} from '../src/index.ts';
testStable('counts, dates, anchors and mentions', () => {
  assert.strictEqual(fileCount('english', 1), '1 file');
  assert.strictEqual(sourceCount('italian', 2), '2 fonti');
  assert.strictEqual(examCountdown('italian', -1), "L'esame è passato");
  assert.strictEqual(practiceFigure('italian', 'correct', 1), '1 corretta');
  assert.strictEqual(age('english', 604800), '1w');
  const today = { year: 2026, month: 3, day: 1 },
    yesterday = { year: 2026, month: 2, day: 28 };

  assert.strictEqual(dayLabel('italian', today, yesterday), 'Ieri');
  assert.strictEqual(moment('english', today, yesterday, [23, 59]), 'Yesterday 23:59');
  assert.strictEqual(recordingClock(3723), '1:02:03');
  assert.strictEqual(
    pastedImageName('italian', { year: 2026, month: 1, day: 2 }, [3, 4, 5], 'jpg'),
    'Immagine incollata 2026-01-02 03.04.05.jpg'
  );
  assert.strictEqual(
    anchorLabel('english', { kind: 'time', startMs: 245000, endMs: 280400 }),
    '4:05–4:40'
  );
  assert.strictEqual(
    citationLabel('english', 1, 'example.org', { kind: 'url' }),
    '[1] example.org'
  );
  expect(mentionSuggestions('hey @ST', 7)).toStrictEqual({
    start: 4,
    end: 7,
    mentions: ['assistant']
  });
  assert.strictEqual(mentionSuggestions('@study', 2), undefined);
});

import { createLocalization, countText } from '../src/index.ts';
testStable('localized plurals cover zero, one and many in both locales', () => {
  for (const [locale, expected] of [
    ['english', ['0 sources', '1 source', '3 sources']],
    ['italian', ['0 fonti', '1 fonte', '3 fonti']]
  ] as const) {
    expect([0, 1, 3].map((count) => countText(locale, 'source', count))).toStrictEqual(expected);
  }
});
testStable('locale-bound and server translations remain isolated', () => {
  const english = createLocalization('english');
  const italian = createLocalization('italian');

  assert.strictEqual(english.t('Home'), 'Overview');
  assert.strictEqual(italian.t('Home'), 'Panoramica');
  assert.strictEqual(text('english', 'Home'), 'Overview');
  assert.strictEqual(text('italian', 'Home'), 'Panoramica');
});

testStable('English and Italian catalogs have exactly the same message keys', () => {
  expect(Object.keys(catalogs.italian).sort()).toStrictEqual(Object.keys(catalogs.english).sort());
});
