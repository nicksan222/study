import type { test } from '@study/testing';

// Compiled with the server environment to keep fixture capabilities separate.
function fixtureContract(unit: test.unit.Context, server: test.server.Context) {
  void unit.expect;
  void server.db;
  void server.rpc.client;
  // @ts-expect-error unit tests cannot acquire the application fixture
  void unit.server;
  // @ts-expect-error server tests have no Playwright page
  void server.page;
  // @ts-expect-error server tests cannot capture screenshots
  void server.expectScreenshot;
  // @ts-expect-error server tests cannot run browser accessibility scans
  void server.expectAccessibility;
}

void fixtureContract;
