import { catalogs, createLocalization, text } from '@study/localization';
import { test } from '@study/testing';

test.stable('translations require parameters and replace them literally', () => {
  const l = createLocalization('italian');

  test.assert.strictEqual(l.t('Home'), 'Panoramica');
  test.assert.strictEqual(
    l.t('SubjectWelcome', { subject: '$& {count} <Biology>' }),
    'Torna a $& {count} <Biology>'
  );
  test.assert.strictEqual(text('english', 'SubjectDueCards', { count: 3 }), '3 flashcards due');
});

test.stable('localizations are immutable, isolated, and safe to destructure', () => {
  const english = createLocalization('english');
  const italian = createLocalization('italian');
  const { t, count, number, date } = italian;

  test.assert.ok(Object.isFrozen(english));
  test.assert.strictEqual(english.locale, 'english');
  test.assert.strictEqual(italian.locale, 'italian');
  test.assert.strictEqual(t('Home'), 'Panoramica');
  test.assert.strictEqual(english.t('Home'), 'Overview');
  test.assert.strictEqual(count('source', 2), '2 fonti');
  test.assert.strictEqual(number(1234n), new Intl.NumberFormat('it-IT').format(1234n));
  test.assert.strictEqual(number(0.5, { style: 'percent' }), '50%');
  test.assert.strictEqual(
    date(0n, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
    new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }).format(0)
  );
});

test.stable('date options accept individual Intl fields', () => {
  const l = createLocalization('english');

  test.assert.strictEqual(l.date(0, { year: 'numeric', timeZone: 'UTC' }), '1970');
});

test.stable('catalog exports cannot mutate existing or future translators', () => {
  test.assert.ok(Object.isFrozen(catalogs));
  test.assert.ok(Object.isFrozen(catalogs.english));
  test.assert.ok(Object.isFrozen(catalogs.italian));
});
