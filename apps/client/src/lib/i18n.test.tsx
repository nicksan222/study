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

test.unit.describe('desktop language provider', () => {
  test.unit.stable(
    'switches independently and preserves the server locale',
    ({ render, expect, screen, cleanup }) => {
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
      const rendered = render(view('english'));

      expect(screen.getByTestId('first').textContent).toBe('english:Overview:1,234');
      rendered.rerender(view('italian'));
      expect(screen.getByTestId('first').textContent).toBe(
        `italian:Panoramica:${new Intl.NumberFormat('it-IT').format(1234)}`
      );
      expect(screen.getByTestId('second').textContent).toBe('english:Overview:1,234');
      rendered.rerender(view('english'));
      expect(screen.getByTestId('first').textContent).toBe('english:Overview:1,234');
      cleanup();
    }
  );

  test.unit.stable(
    'defaults to English outside a provider',
    ({ render, expect, screen, cleanup }) => {
      render(<Copy name="default" />);
      expect(screen.getByTestId('default').textContent).toBe('english:Overview:1,234');
      cleanup();
    }
  );
});
