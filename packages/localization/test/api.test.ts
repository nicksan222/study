import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { catalogs, createLocalization, text } from '@study/localization';

test('translations require parameters and replace them literally', () => {
  const l = createLocalization('italian');

  assert.equal(l.t('Home'), 'Panoramica');
  assert.equal(
    l.t('SubjectWelcome', { subject: '$& {count} <Biology>' }),
    'Torna a $& {count} <Biology>'
  );
  assert.equal(text('english', 'SubjectDueCards', { count: 3 }), '3 flashcards due');
});

test('localizations are immutable, isolated, and safe to destructure', () => {
  const english = createLocalization('english');
  const italian = createLocalization('italian');
  const { t, count, number, date } = italian;

  assert.ok(Object.isFrozen(english));
  assert.equal(english.locale, 'english');
  assert.equal(italian.locale, 'italian');
  assert.equal(t('Home'), 'Panoramica');
  assert.equal(english.t('Home'), 'Overview');
  assert.equal(count('source', 2), '2 fonti');
  assert.equal(number(1234n), new Intl.NumberFormat('it-IT').format(1234n));
  assert.equal(number(0.5, { style: 'percent' }), '50%');
  assert.equal(
    date(0n, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
    new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }).format(0)
  );
});

test('date options accept individual Intl fields', () => {
  const l = createLocalization('english');

  assert.equal(l.date(0, { year: 'numeric', timeZone: 'UTC' }), '1970');
});

test('catalog exports cannot mutate existing or future translators', () => {
  assert.ok(Object.isFrozen(catalogs));
  assert.ok(Object.isFrozen(catalogs.english));
  assert.ok(Object.isFrozen(catalogs.italian));
});
