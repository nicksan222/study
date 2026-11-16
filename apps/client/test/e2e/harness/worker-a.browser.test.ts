import { catalogs } from '@study/localization';
import { test } from '@study/testing';

// Keep consecutive fixtures in one worker to verify cleanup between tests.
test.browser.describe.configure({ mode: 'default' });

const copy = catalogs.english;

test.browser.stable(
  'one application fixture can save private browser and SQLite state',
  async ({ page, rpc, expect }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'RPC isolation sentinel' })
    );

    await page.goto('/notes');
    await page.getByRole('combobox', { name: copy.ChooseProject }).click();
    await expect(page.getByRole('option', { name: project.name, exact: true })).toBeVisible();
    await page.getByRole('option', { name: project.name, exact: true }).click();
    expect(await rpc.runPromise(rpc.client['projects.project']({ id: project.id }))).toMatchObject({
      id: project.id,
      name: project.name
    });
    await page.goto('/notes');
    await page.evaluate(() => localStorage.setItem('sentinel', 'private'));
    await page.context().addCookies([{ name: 'sentinel', value: 'private', url: page.url() }]);
    await page.getByRole('textbox', { name: copy.NoteCompose }).fill('Isolation sentinel');
    await page.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(page).toHaveURL(/\/notes\/.+/);
    expect((await rpc.runPromise(rpc.client['notes.notes']({ limit: 10 }))).items).toHaveLength(1);
  }
);

test.browser.stable(
  'the next application fixture has fresh browser storage and SQLite rows',
  async ({ page, rpc, expect }) => {
    expect(
      (await rpc.runPromise(rpc.client['projects.projects']({ limit: 10 }))).items
    ).toHaveLength(0);
    expect((await rpc.runPromise(rpc.client['notes.notes']({ limit: 10 }))).items).toHaveLength(0);
    await page.goto('/notes');
    await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sentinel'))).toBeNull();
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'sentinel')).toBe(
      false
    );
    await expect(page.getByText('Isolation sentinel', { exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: copy.ChooseProject }).click();
    await expect(
      page.getByRole('option', { name: 'RPC isolation sentinel', exact: true })
    ).toHaveCount(0);
  }
);
