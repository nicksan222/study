import type { test } from '@study/testing';

// Compiled with the browser environment; RPC retains its canonical input schemas.
function fixtureContract(browser: test.browser.Context) {
  void browser.page;
  void browser.expectScreenshot;
  void browser.expectAccessibility;
  void browser.rpc.client['projects.createProject']({ name: 'Seeded project' });
  // @ts-expect-error RPC inputs are schema typed
  void browser.rpc.client['projects.createProject']({ name: 123 });
  // @ts-expect-error browser tests do not expose a raw database fixture
  void browser.db;
}

void fixtureContract;
