import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { catalogs } from '../src/catalog.ts';
import {
  text,
  joined,
  choiceLabel,
  materialFileName,
  mediaSize,
  secondsTaken
} from '../src/index.ts';
test('catalog and formatting match the Rust examples', () => {
  assert.equal(text('italian', 'Home'), 'Panoramica');
  assert.equal(joined(['Question 1', '', 'PDF']), 'Question 1 · PDF');
  assert.equal(choiceLabel(1, 'Ribosomes'), 'B. Ribosomes');
  assert.equal(materialFileName('english', 'Cells / ATP: why?', 'svg'), 'Cells   ATP  why.svg');
  assert.equal(materialFileName('italian', '*', 'md'), 'Senza titolo.md');
  assert.equal(mediaSize('english', 1048524), '1023.9 KiB');
  assert.equal(mediaSize('english', 1048525), '1.0 MiB');
  assert.equal(secondsTaken('italian', 4.2), '4,2 s');
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
test('counts, dates, anchors and mentions', () => {
  assert.equal(fileCount('english', 1), '1 file');
  assert.equal(sourceCount('italian', 2), '2 fonti');
  assert.equal(examCountdown('italian', -1), "L'esame è passato");
  assert.equal(practiceFigure('italian', 'correct', 1), '1 corretta');
  assert.equal(age('english', 604800), '1w');
  const today = { year: 2026, month: 3, day: 1 },
    yesterday = { year: 2026, month: 2, day: 28 };

  assert.equal(dayLabel('italian', today, yesterday), 'Ieri');
  assert.equal(moment('english', today, yesterday, [23, 59]), 'Yesterday 23:59');
  assert.equal(recordingClock(3723), '1:02:03');
  assert.equal(
    pastedImageName('italian', { year: 2026, month: 1, day: 2 }, [3, 4, 5], 'jpg'),
    'Immagine incollata 2026-01-02 03.04.05.jpg'
  );
  assert.equal(
    anchorLabel('english', { kind: 'time', startMs: 245000, endMs: 280400 }),
    '4:05–4:40'
  );
  assert.equal(citationLabel('english', 1, 'example.org', { kind: 'url' }), '[1] example.org');
  assert.deepEqual(mentionSuggestions('hey @ST', 7), {
    start: 4,
    end: 7,
    mentions: ['assistant']
  });
  assert.equal(mentionSuggestions('@study', 2), undefined);
});

import { createLocalization, countText } from '../src/index.ts';
test('localized plurals cover zero, one and many in both locales', () => {
  for (const [locale, expected] of [
    ['english', ['0 sources', '1 source', '3 sources']],
    ['italian', ['0 fonti', '1 fonte', '3 fonti']]
  ] as const) {
    assert.deepEqual(
      [0, 1, 3].map((count) => countText(locale, 'source', count)),
      expected
    );
  }
});
test('locale-bound and backend translations remain isolated', () => {
  const english = createLocalization('english');
  const italian = createLocalization('italian');

  assert.equal(english.t('Home'), 'Overview');
  assert.equal(italian.t('Home'), 'Panoramica');
  assert.equal(text('english', 'Home'), 'Overview');
  assert.equal(text('italian', 'Home'), 'Panoramica');
});

test('English and Italian catalogs have exactly the same message keys', () => {
  assert.deepEqual(Object.keys(catalogs.italian).sort(), Object.keys(catalogs.english).sort());
});
