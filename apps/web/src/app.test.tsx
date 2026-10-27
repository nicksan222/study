import { catalogs } from '@study/localization';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';

import { App } from './app';

it.each(['/', '/#/unknown'])('opens Home for %s', async (url) => {
  history.replaceState(null, '', url);
  render(<App />);
  expect(await screen.findByRole('heading', { name: catalogs.english.Home })).toBeInTheDocument();
});
