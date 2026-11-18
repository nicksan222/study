import type { test } from '@study/testing';

// Compiled with the browser environment; RPC retains its canonical input schemas.
function fixtureContract(browser: test.browser.Context) {
  void browser.page;
  void browser.expectScreenshot;
  void browser.expectAccessibility;
  void browser.microphone.start;
  // @ts-expect-error speech controls are exposed through the microphone fixture
  void browser.voice;
  void browser.rpc.client['projects.createProject']({ name: 'Seeded project' });
  // @ts-expect-error RPC inputs are schema typed
  void browser.rpc.client['projects.createProject']({ name: 123 });
  // @ts-expect-error browser tests do not expose a raw database fixture
  void browser.db;
}

void fixtureContract;
