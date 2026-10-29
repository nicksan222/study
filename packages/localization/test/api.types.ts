// Included in server:typecheck; these calls are never executed.
import { createLocalization, text, catalogs } from '@study/localization';
import type { MessageKey, StaticMessageKey } from '@study/localization';

function publicContract(key: MessageKey, label: StaticMessageKey) {
  const l = createLocalization('english');

  l.t('Home');
  l.t(label);
  // @ts-expect-error unknown count category
  l.count('missing', 1);
  // @ts-expect-error catalogs cannot be changed by consumers
  catalogs.english.Home = 'Changed';
  // @ts-expect-error parameterized messages cannot be used as static labels
  const invalidLabel: StaticMessageKey = 'SubjectWelcome';

  void invalidLabel;
  l.t('SubjectWelcome', { subject: 'Biology' });
  text('italian', 'SubjectDueCards', { count: 2 });
  // @ts-expect-error unknown message
  l.t('MissingMessage');
  // @ts-expect-error missing required interpolation
  l.t('SubjectWelcome');
  // @ts-expect-error wrong interpolation name
  l.t('SubjectWelcome', { name: 'Biology' });
  // @ts-expect-error excess interpolation
  l.t('SubjectWelcome', { subject: 'Biology', extra: 1 });
  const params = { subject: 'Biology', extra: 1 };

  // @ts-expect-error excess fields in a variable
  l.t('SubjectWelcome', params);
  // @ts-expect-error excess fields at the locale-explicit entry point
  text('english', 'SubjectWelcome', params);
  // @ts-expect-error excess fields from a spread
  l.t('SubjectWelcome', { ...params });
  // @ts-expect-error plain messages take no parameters
  l.t('Home', { subject: 'Biology' });
  // @ts-expect-error invalid interpolation value
  l.t('SubjectDueCards', { count: {} });
  // @ts-expect-error a union containing parameterized keys requires narrowing
  l.t(key);
  // @ts-expect-error locales are fixed
  l.locale = 'italian';
  // @ts-expect-error no mutable language API
  l.changeLanguage('it');
  // @ts-expect-error only supported locale identifiers
  createLocalization('en');
}

void publicContract;
