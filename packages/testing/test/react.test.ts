import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

testStable('shared React setup waits for delayed UI without case-specific timeouts', async () => {
  const button = document.createElement('button');

  button.textContent = 'Loaded action';
  const timer = setTimeout(() => document.body.append(button), 1200);

  try {
    expect(await screen.findByRole('button', { name: 'Loaded action' })).toBe(button);
  } finally {
    clearTimeout(timer);
    button.remove();
  }
});
