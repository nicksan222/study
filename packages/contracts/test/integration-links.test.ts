import { validDocumentHref } from '@study/contracts/sources/schemas';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

testStable.each([
  ['/note/1', true],
  ['/note/42#Cell%20division', true],
  ['https://example.org/note', true],
  ['mailto:reader@example.org', true],
  ['//example.org/note/1', false],
  ['/note/0', false],
  ['/note/9223372036854775808', false],
  ['/note/1/../../settings', false],
  ['/note/1?redirect=https://example.org', false],
  ['javascript:alert(1)', false],
  ['data:text/html,test', false]
])('validates imported document href %s', (value, allowed) => {
  expect(validDocumentHref(value as string)).toBe(allowed);
});
