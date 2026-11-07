import { validDocumentHref } from '@study/contracts/sources/schemas';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

testStable.each([
  ['/session/1', true],
  ['/session/42#Cell%20division', true],
  ['https://example.org/note', true],
  ['mailto:reader@example.org', true],
  ['//example.org/session/1', false],
  ['/session/0', false],
  ['/session/9223372036854775808', false],
  ['/session/1/../../settings', false],
  ['/session/1?redirect=https://example.org', false],
  ['javascript:alert(1)', false],
  ['data:text/html,test', false]
])('validates imported document href %s', (value, allowed) => {
  expect(validDocumentHref(value as string)).toBe(allowed);
});
