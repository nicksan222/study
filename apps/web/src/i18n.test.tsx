import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vite-plus/test';

import { LanguageProvider, useI18n } from './i18n.tsx';

function Copy({ name }: { name: string }) {
  const { t, number, locale } = useI18n();

  return (
    <span data-testid={name}>
      {locale}:{t('Home')}:{number(1234)}
    </span>
  );
}

describe('desktop language provider', () => {
  it('switches independently and preserves the backend locale', () => {
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
  });

  it('defaults to English outside a provider', () => {
    render(<Copy name="default" />);
    expect(screen.getByTestId('default').textContent).toBe('english:Overview:1,234');
    cleanup();
  });
});
