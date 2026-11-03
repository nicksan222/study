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

// ProseMirror reads selection geometry; jsdom provides no layout boxes.
if (typeof Range !== 'undefined') {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect()
  });
}
