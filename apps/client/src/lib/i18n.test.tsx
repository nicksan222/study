import { test } from '@study/testing';
import React from 'react';

import { LanguageProvider, useI18n } from './i18n.tsx';

function Copy({ name }: { name: string }) {
  const { t, number, locale } = useI18n();

  return (
    <span data-testid={name}>
      {locale}:{t('Home')}:{number(1234)}
    </span>
  );
}

test.describe('desktop language provider', () => {
  test.stable('switches independently and preserves the server locale', () => {
    const view = (locale: 'english' | 'italian') => (
      <>
        <LanguageProvider locale={locale}>
          <Copy name="first" />
        </LanguageProvider>
        <LanguageProvider locale="english">
          <Copy name="second" />
        </LanguageProvider>
      </>
    );
    const rendered = test.render(view('english'));

    test.expect(test.screen.getByTestId('first').textContent).toBe('english:Overview:1,234');
    rendered.rerender(view('italian'));
    test
      .expect(test.screen.getByTestId('first').textContent)
      .toBe(`italian:Panoramica:${new Intl.NumberFormat('it-IT').format(1234)}`);
    test.expect(test.screen.getByTestId('second').textContent).toBe('english:Overview:1,234');
    rendered.rerender(view('english'));
    test.expect(test.screen.getByTestId('first').textContent).toBe('english:Overview:1,234');
    test.cleanup();
  });

  test.stable('defaults to English outside a provider', () => {
    test.render(<Copy name="default" />);
    test.expect(test.screen.getByTestId('default').textContent).toBe('english:Overview:1,234');
    test.cleanup();
  });
});
