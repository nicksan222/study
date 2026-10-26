import { test as base, expect } from '@playwright/test';
import { createStudyClient } from '../../apps/desktop/src/rpc/client';
import { Appearance, Language } from '../../apps/desktop/src/generated/study_pb';

type Backend = ReturnType<typeof createStudyClient>;
export const test = base.extend<{ fixtureSession: string; backend: Backend }>({
  fixtureSession: [async ({ request }, use) => {
    const response = await request.post('/rpc/__study/session', { data: { seed: true } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const { id } = await response.json() as { id: string };
    try { await use(id); }
    finally {
      const deleted = await request.delete(`/rpc/__study/session/${id}`);
      expect(deleted.status(), 'test backend and temporary database must be released').toBe(204);
    }
  }, { auto: true }],
  backend: async ({ request, fixtureSession }, use) => {
    // An independent generated consumer verifies persistence after UI actions.
    const client = createStudyClient(async (method, payload) => {
      const response = await request.post(`/rpc/${method}`, { headers: { 'content-type': 'application/protobuf', 'x-study-session': fixtureSession }, data: Buffer.from(payload) });
      if (!response.ok()) throw new Error(`RPC ${method}: ${response.status()} ${await response.text()}`);
      return new Uint8Array(await response.body());
    });
    await use(client);
  },
  page: async ({ page, fixtureSession, backend }, use) => {
    const settings = await backend.getAppSettings({});
    await backend.saveAppSettings({ ...settings, language: Language.ENGLISH, appearance: Appearance.LIGHT, zoomPercent: 100, onboarded: true });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(id => localStorage.setItem('study.fixture-session', id), fixtureSession);
    await use(page);
    expect(errors, 'production frontend must not throw uncaught errors').toEqual([]);
  },
});
export { expect };
