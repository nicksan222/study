import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vite-plus/test';
afterEach(cleanup);

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    })
  });

  class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverStub;
  Element.prototype.getAnimations = () => [];

  window.scrollTo = vi.fn();
}
