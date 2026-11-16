import { catalogs, createLocalization, text } from '@study/localization';
import { test } from '@study/testing';

test.stable(
  'translations require parameters and replace them literally',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const l = createLocalization('italian');

    assert.strictEqual(l.t('Home'), 'Panoramica');
    assert.strictEqual(
      l.t('SubjectWelcome', { subject: '$& {count} <Biology>' }),
      'Torna a $& {count} <Biology>'
    );
    assert.strictEqual(text('english', 'SubjectDueCards', { count: 3 }), '3 flashcards due');
  }
);

test.stable(
  'localizations are immutable, isolated, and safe to destructure',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const english = createLocalization('english');
    const italian = createLocalization('italian');
    const { t, count, number, date } = italian;

    assert.ok(Object.isFrozen(english));
    assert.strictEqual(english.locale, 'english');
    assert.strictEqual(italian.locale, 'italian');
    assert.strictEqual(t('Home'), 'Panoramica');
    assert.strictEqual(english.t('Home'), 'Overview');
    assert.strictEqual(count('source', 2), '2 fonti');
    assert.strictEqual(number(1234n), new Intl.NumberFormat('it-IT').format(1234n));
    assert.strictEqual(number(0.5, { style: 'percent' }), '50%');
    assert.strictEqual(
      date(0n, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
      new Intl.DateTimeFormat('it-IT', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(0)
    );
  }
);

test.stable('date options accept individual Intl fields', ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const l = createLocalization('english');

  assert.strictEqual(l.date(0, { year: 'numeric', timeZone: 'UTC' }), '1970');
});

test.stable(
  'catalog exports cannot mutate existing or future translators',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.ok(Object.isFrozen(catalogs));
    assert.ok(Object.isFrozen(catalogs.english));
    assert.ok(Object.isFrozen(catalogs.italian));
  }
);
